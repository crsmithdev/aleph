use {
    crate::{
        assets::TextureHandle,
        material::Material,
        model::{Mesh, Primitive, Vertex},
        util, Assets, Camera, Node, NodeData, Scene,
    },
    aleph_vk::{
        texture::{SamplerDesc, TextureDesc},
        AllocatedTexture, Extent2D, Gpu, ImageUsageFlags, MemoryLocation, PrimitiveTopology,
    },
    anyhow::{bail, Result},
    ash::vk,
    derive_more::Debug,
    glam::{Mat4, Vec2, Vec3, Vec4},
    gltf::Texture,
    itertools::Itertools,
    petgraph::graph::NodeIndex,
    std::{
        cell::RefCell,
        collections::{HashMap, HashSet},
        mem::size_of,
        rc::Rc,
    },
};

pub type Graph = petgraph::Graph<Node, ()>;

#[derive(Debug)]
pub struct GltfScene {
    pub document: gltf::Document,
    pub buffers: Vec<gltf::buffer::Data>,
    pub images: Vec<gltf::image::Data>,
}

pub fn load<'a>(gpu: &Gpu, path: &str, assets: &'a mut Assets) -> Result<Scene<'a>> {
    let (document, buffers, images) = gltf::import(path)?;

    let mut srgb_textures = HashSet::new();
    for material in document.materials() {
        let pbr = material.pbr_metallic_roughness();
        if let Some(info) = pbr.base_color_texture() {
            srgb_textures.insert(info.texture().index());
        }
    }

    let mut textures: HashMap<usize, TextureHandle> = HashMap::new();
    for index in 0..document.textures().len() {
        let info = document.textures().nth(index).unwrap();
        let srgb = srgb_textures.contains(&index);
        let data = &images[info.source().index()];
        let name = match info.name() {
            Some(name) => format!("gltf-{index:02}-{name}",),
            None => format!("gltf-{index:02}"),
        };
        let sampler = load_sampler(gpu, info.sampler())?;

        let extent = Extent2D {
            width: data.width,
            height: data.height,
        };
        let bytes = match data.format {
            gltf::image::Format::R8G8B8A8 => data.pixels.clone(),
            gltf::image::Format::R8G8B8 => util::rgb_to_rgba(&data.pixels, extent),
            _ => bail!("Unsupported image format: {:?}", data.format),
        };
        let format = match srgb {
            true => vk::Format::R8G8B8A8_SRGB,
            false => vk::Format::R8G8B8A8_UNORM,
        };
        let usage = vk::ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED;
        let aspect = vk::ImageAspectFlags::COLOR;
        let handle = assets.add_texture(TextureDesc {
            name,
            extent,
            format,
            usage,
            aspect,
            data: data.pixels.clone(),
            sampler: SamplerDesc {
                name: format!("gltf-sampler-{index:02}"),
                index,
                min_filter: vk::Filter::LINEAR,
                mag_filter: vk::Filter::LINEAR,
                mipmap_mode: vk::SamplerMipmapMode::LINEAR,
                address_mode_u: vk::SamplerAddressMode::REPEAT,
                address_mode_v: vk::SamplerAddressMode::REPEAT,
                anisotropy_enable: false,
                max_anisotropy: 1.0,
            },
        });
        textures.insert(index, handle);
    }
    let textures = textures
        .into_iter()
        .sorted_by_key(|t| t.0)
        .map(|t| t.1)
        .collect::<Vec<_>>();

    let mut materials: HashMap<usize, Material> = HashMap::new();
    for index in 0..document.materials().len() {
        let source = document.materials().nth(index).unwrap();
        let material = load_material(&source)?;
        materials.insert(index, material);
    }

    let mut meshes: HashMap<usize, Mesh> = HashMap::new();
    for index in 0..document.meshes().len() {
        let source = document.meshes().nth(index).unwrap();
        let mesh = load_mesh(gpu, &source, &buffers)?;
        meshes.insert(index, mesh);
    }

    let mut graph = Graph::new();
    let root = graph.add_node(Node {
        name: "gltf-root".to_string(),
        transform: Mat4::IDENTITY,
        data: NodeData::Empty,
    });
    let scene = match document.scenes().nth(0) {
        Some(scene) => scene,
        None => bail!("No scenes found in the glTF file"),
    };

    for node in scene.nodes() {
        let child_index = add_node(gpu, &mut graph, node);
        graph.add_edge(root, child_index, ());
    }
    let meshes = meshes
        .into_iter()
        .sorted_by_key(|t| t.0)
        .map(|t| t.1)
        .collect::<Vec<_>>();

    log::debug!("Loaded glTF scene from: {}", path);
    log::debug!("  Nodes ({}):", graph.node_count());
    for index in graph.node_indices() {
        let node = &graph[index];
        let children = graph.neighbors(index).collect::<Vec<_>>();
        log::debug!(
            "    #{index:?} ({}): transform: {:?}, children: {:?}",
            node.name,
            node.transform.to_cols_array_2d(),
            children
        );
    }
    log::debug!("  Materials ({}):", materials.len());
    for index in materials.keys() {
        let material = &materials[index];
        log::debug!("    #{index:?} -> {:?}", material);
    }
    log::debug!("  Textures ({}):", textures.len());
    for index in 0..textures.len() {
        let texture = &textures[index];
        log::debug!("    #{index:?} -> {:?}", texture);
    }
    log::debug!("  Meshes ({}):", meshes.len());
    for index in 0..meshes.len() {
        let mesh = &meshes[index];
        log::debug!("    #{index:?} -> {} primitives", mesh.primitives.len());
        for primitive in &mesh.primitives {
            log::debug!(
                "      {} vertices -> material: {:?}",
                primitive.vertex_count,
                primitive.material
            );
        }
    }

    Ok(Scene {
        camera: Camera::new(crate::CameraConfig::default()),
        graph: Rc::new(RefCell::new(graph)),
        root,
        assets: assets as &'a mut Assets,
    })
}

fn add_node(gpu: &Gpu, graph: &mut Graph, gltf_node: gltf::Node) -> NodeIndex {
    let transform = Mat4::from_cols_array_2d(&gltf_node.transform().matrix());
    let index = gltf_node.index();
    let name = match gltf_node.name() {
        Some(name) => format!("gltf-node{index}-{}", name),
        None => format!("gltf-node{index}"),
    };
    let data = match gltf_node.mesh() {
        Some(mesh) => NodeData::Mesh(mesh.index()),
        None => NodeData::Empty,
    };

    let node_index = graph.add_node(Node {
        name: name.clone(),
        transform,
        data,
    });

    log::debug!("Loaded node {name} (transform: {:?})", transform);

    for child in gltf_node.children() {
        let child_index = add_node(gpu, graph, child);
        graph.add_edge(node_index, child_index, ());
    }

    node_index
}

fn load_material(material: &gltf::Material) -> Result<Material> {
    let index = match material.index() {
        Some(index) => index,
        None => bail!("Material index not found"),
    };
    let name = format!(
        "gltf-material-{:02}-{}",
        index,
        material.name().unwrap_or("unnamed")
    );
    log::debug!("Loading material {name}...");
    let pbr = material.pbr_metallic_roughness();
    let base_texture = pbr.base_color_texture().map(|i| i.texture().index());
    log::debug!("{name} base texture -> {base_texture:?}");
    let normal_texture = material.normal_texture().map(|i| i.texture().index());
    log::debug!("{name} normal texture -> {normal_texture:?}");
    let metallic_roughness_texture = pbr
        .metallic_roughness_texture()
        .map(|i| i.texture().index());
    log::debug!("{name} metallic roughness texture -> {metallic_roughness_texture:?}");
    let occlusion_texture = material.occlusion_texture().map(|i| i.texture().index());

    let base_color = Vec4::from_array(pbr.base_color_factor());
    let metallic_factor = pbr.metallic_factor();
    let roughness_factor = pbr.roughness_factor();
    let occlusion_factor = material.occlusion_texture().map_or(0.0, |i| i.strength());

    Ok(Material {
        name,
        base_texture: base_texture,
        base_color,
        normal_texture: normal_texture,
        metallic_roughness_texture,
        metallic_factor,
        roughness_factor,
        ao_texture: occlusion_texture,
        ao_strength: occlusion_factor,
    })
}

fn load_mesh(gpu: &Gpu, source: &gltf::Mesh, buffers: &Vec<gltf::buffer::Data>) -> Result<Mesh> {
    let name = {
        let index = source.index();
        let base = format!("gltf-mesh{index:02}");
        source
            .name()
            .map(|name| format!("{base}-{name}"))
            .unwrap_or(base)
    };
    log::debug!("Loading mesh {name}...");
    let mut primitives = vec![];
    for primitive in source.primitives() {
        let reader = primitive.reader(|buffer| Some(&buffers[buffer.index()]));

        let positions = reader
            .read_positions()
            .map_or(Vec::new(), |positions| positions.map(Vec3::from).collect());
        let normals = reader
            .read_normals()
            .map_or(Vec::new(), |normals| normals.map(Vec3::from).collect());

        let to_vec = |coords: gltf::mesh::util::ReadTexCoords<'_>| -> Vec<Vec2> {
            coords.into_f32().map(Vec2::from).collect()
        };
        let tex_coords_0 = reader.read_tex_coords(0).map_or(Vec::new(), to_vec);
        let tangents = reader
            .read_tangents()
            .map_or(Vec::new(), |tangents| tangents.map(Vec4::from).collect());
        let colors = reader.read_colors(0).map_or(Vec::new(), |colors| {
            colors.into_rgba_f32().map(Vec4::from).collect::<Vec<_>>()
        });

        let vertices: Vec<Vertex> = positions
            .iter()
            .enumerate()
            .map(|(index, position)| {
                let uv = *tex_coords_0.get(index).unwrap_or(&Vec2::ZERO);
                Vertex {
                    position: *position,
                    normal: *normals.get(index).unwrap_or(&Vec3::ZERO),
                    uv_x: uv.x,
                    uv_y: uv.y,
                    tangent: *tangents.get(index).unwrap_or(&Vec4::ZERO),
                    color: *colors.get(index).unwrap_or(&Vec4::ONE),
                }
            })
            .collect();
        let indices = reader
            .read_indices()
            .map(|read_indices| read_indices.into_u32().collect::<Vec<_>>())
            .unwrap();

        let index_size = size_of::<u32>() as u64 * indices.len() as u64;
        let index_buffer =
            gpu.create_index_buffer(index_size, MemoryLocation::GpuOnly, "index buffer")?;
        let index_staging = util::staging_buffer(gpu, &indices, "index staging")?;

        let vertex_size = size_of::<Vertex>() as u64 * vertices.len() as u64;
        let vertex_buffer =
            gpu.create_vertex_buffer(vertex_size, MemoryLocation::GpuOnly, "vertex buffer")?;
        let vertex_staging = util::staging_buffer(gpu, &vertices, "vertex staging")?;

        gpu.execute(|cmd| {
            cmd.copy_buffer(&vertex_staging, &vertex_buffer, vertex_buffer.size());
            cmd.copy_buffer(&index_staging, &index_buffer, index_buffer.size());
        })?;

        let material = primitive.material().index();

        primitives.push(Primitive {
            vertex_buffer,
            index_buffer,
            material,
            vertex_count: indices.len() as u32,
            topology: PrimitiveTopology::TRIANGLE_LIST,
        });
        log::debug!(
            "  Loaded primitive {} -> {} vertices",
            primitive.index(),
            vertices.len()
        );
    }

    Ok(Mesh { name, primitives })
}

fn load_sampler(gpu: &Gpu, sampler: gltf::texture::Sampler) -> Result<ash::vk::Sampler> {
    use gltf::texture::{MagFilter, MinFilter, WrappingMode};
    let min_filter = match sampler.min_filter() {
        Some(MinFilter::Nearest) => vk::Filter::NEAREST,
        Some(MinFilter::NearestMipmapNearest) => vk::Filter::NEAREST,
        Some(MinFilter::NearestMipmapLinear) => vk::Filter::NEAREST,
        Some(MinFilter::Linear) => vk::Filter::LINEAR,
        Some(MinFilter::LinearMipmapNearest) => vk::Filter::LINEAR,
        Some(MinFilter::LinearMipmapLinear) => vk::Filter::LINEAR,
        None => vk::Filter::LINEAR,
    };
    let mag_filter = match sampler.mag_filter() {
        Some(MagFilter::Nearest) => vk::Filter::NEAREST,
        Some(MagFilter::Linear) => vk::Filter::LINEAR,
        None => vk::Filter::LINEAR,
    };
    let address_mode_u = match sampler.wrap_s() {
        WrappingMode::ClampToEdge => vk::SamplerAddressMode::CLAMP_TO_EDGE,
        WrappingMode::MirroredRepeat => vk::SamplerAddressMode::MIRRORED_REPEAT,
        WrappingMode::Repeat => vk::SamplerAddressMode::REPEAT,
    };
    let address_mode_y = match sampler.wrap_t() {
        WrappingMode::ClampToEdge => vk::SamplerAddressMode::CLAMP_TO_EDGE,
        WrappingMode::MirroredRepeat => vk::SamplerAddressMode::MIRRORED_REPEAT,
        WrappingMode::Repeat => vk::SamplerAddressMode::REPEAT,
    };
    let mipmap_mode = match sampler.min_filter() {
        Some(MinFilter::Nearest) => vk::SamplerMipmapMode::NEAREST,
        Some(MinFilter::NearestMipmapNearest) => vk::SamplerMipmapMode::NEAREST,
        Some(MinFilter::NearestMipmapLinear) => vk::SamplerMipmapMode::NEAREST,
        Some(MinFilter::Linear) => vk::SamplerMipmapMode::LINEAR,
        Some(MinFilter::LinearMipmapNearest) => vk::SamplerMipmapMode::LINEAR,
        Some(MinFilter::LinearMipmapLinear) => vk::SamplerMipmapMode::LINEAR,
        _ => vk::SamplerMipmapMode::LINEAR,
    };
    gpu.create_sampler(&SamplerDesc {
        name: format!("gltf-sampler-{:02}", 42),
        index: 0,
        min_filter,
        mag_filter,
        mipmap_mode,
        address_mode_u,
        address_mode_v: address_mode_y,
        anisotropy_enable: false,
        max_anisotropy: 1.0,
    })
}
// #[cfg(test)]
// mod tests {
//  use {
//         super::*,
//         std::{cell::{Cell, LazyCell, OnceCell, RefCell}, os::windows::thread, rc::Rc, sync::{Arc, OnceLock}},
//         winit::{
//             application::ApplicationHandler, event_loop::EventLoop,
//             platform::{run_on_demand::EventLoopExtRunOnDemand, windows::EventLoopBuilderExtWindows},
//         },
//     };
//     struct TestApp {
//         f: Box<dyn Fn(&Gpu)>,
//     }

//     // thread_local! {
//         static window2: OnceLock<winit::window::Window> = OnceLock::new();
//     // }

//     impl ApplicationHandler for TestApp {
//         fn resumed(&mut self, event_loop: &winit::event_loop::ActiveEventLoop) {
//             let attributes = winit::window::WindowAttributes::default().with_visible(false);
//             let window = Arc::new(
//                 event_loop
//                     .create_window(attributes)
//                     .expect("Failed to create window"),
//             );
//             let gpu = Gpu::new(window).expect("Failed to create GPU");

//             (*self.f)(&gpu);

//             event_loop.exit();
//         }

//         fn window_event(
//             &mut self,
//             _event_loop: &winit::event_loop::ActiveEventLoop,
//             _window_id: winit::window::WindowId,
//             _event: winit::event::WindowEvent,
//         ) {
//         }
//     }

//     fn with_gpu<F>(f: F)
//     where
//         F: Fn(&Gpu) -> () + 'static,
//     {
//         let boxed = Box::new(f);
//         let mut app = TestApp { f: boxed };
//         main_event_loop.get_or_init(|| {
//             EventLoopBuilder::new()
//                 .with_windowed_context(None)
//                 .build()
//         });
//         main_event_loop.with(|e| e.borrow_mut().run_app_on_demand(&mut app)).expect("run on demand");
//     }

//     #[test]
//     fn test_load_minimal() {
//         with_gpu(|gpu| {
//             let path = sample_path("Box").expect("path");
//             let result = load(gpu, &path);
//             let scene = result.unwrap();
//             assert_eq!(scene.root.node_count(), 3);
//             assert_eq!(scene.materials.len(), 1);
//             assert_eq!(scene.nodes().len(), 3);
//             assert_eq!(scene.textures.len(), 0);
//             assert_eq!(scene.meshes.len(), 1);
//             assert_eq!(scene.meshes[0].primitives.len(), 1);
//             assert_eq!(scene.meshes[0].primitives[0].vertex_count, 36);
//         });
//     }

//     #[test]
//     fn test_load_texture() {
//         with_gpu(|gpu| {
//             let path = sample_path("").expect("path");
//             let result = load(gpu, &path);
//             println!("Result: {:?}", result);
//             assert!(result.is_ok());

//             let scene = result.unwrap();
//             assert_eq!(scene.root.node_count(), 2);
//             assert_eq!(scene.materials.len(), 1);
//             assert_eq!(scene.nodes().len(), 2);
//             assert_eq!(scene.textures.len(), 1);
//             assert_eq!(scene.meshes.len(), 1);
//             assert_eq!(scene.meshes[0].primitives.len(), 1);
//             assert_eq!(scene.meshes[0].primitives[0].vertex_count, 36);
//         });
//     }
// }
