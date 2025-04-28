use {
    crate::{
        util, Assets, Material, MaterialHandle, MeshDesc, MeshHandle, NodeData, NodeDesc,
        PrimitiveDesc, SceneDesc, TextureHandle, Vertex,
    },
    aleph_vk::{
        Extent2D, Filter, ImageUsageFlags, PrimitiveTopology, SamplerAddressMode, SamplerDesc,
        SamplerMipmapMode, TextureDesc,
    },
    anyhow::{bail, Result},
    ash::vk,
    glam::{Mat4, Vec2, Vec3, Vec4},
    gltf::scene::Transform,
    std::{
        collections::{HashMap, HashSet},
        path::Path,
    },
};

pub fn load_scene(path: &str, mut assets: &mut Assets) -> Result<SceneDesc> {
    log::debug!("Reading glTF scene from {path:?}");

    let (document, buffers, images) = gltf::import(path)?;
    let mut srgb_textures = HashSet::new();

    for material in document.materials() {
        let pbr = material.pbr_metallic_roughness();
        if let Some(info) = pbr.base_color_texture() {
            srgb_textures.insert(info.texture().index());
        }
    }

    let mut samplers = HashMap::new();
    for index in 0..document.samplers().len() {
        let info = document.samplers().nth(index).unwrap();
        let sampler = load_sampler(info);
        samplers.insert(index, sampler);
    }

    let mut textures = HashMap::new();
    for index in 0..document.textures().len() {
        let info = document.textures().nth(index).unwrap();
        let srgb = srgb_textures.contains(&index);
        let data = &images[info.source().index()];
        let sampler = SamplerDesc {
            name: "default".to_string(),
            index: usize::MAX,
            min_filter: vk::Filter::LINEAR,
            mag_filter: vk::Filter::LINEAR,
            mipmap_mode: vk::SamplerMipmapMode::LINEAR,
            address_mode_u: vk::SamplerAddressMode::REPEAT,
            address_mode_v: vk::SamplerAddressMode::REPEAT,
            anisotropy_enable: false,
            max_anisotropy: 1.0,
        };
        let handle = load_texture(&data, &info, sampler, srgb, &mut assets)?;
        textures.insert(index, handle);
    }

    let mut materials = HashMap::new();
    for index in 0..document.materials().len() {
        let source = document.materials().nth(index).unwrap();
        let handle = load_material(&source, &textures, &mut assets)?;
        materials.insert(index, handle);
    }

    let mut meshes: HashMap<usize, MeshHandle> = HashMap::new();
    for index in 0..document.meshes().len() {
        let source = document.meshes().nth(index).unwrap();
        let handle = load_mesh(&source, &buffers, &materials, &mut assets)?;
        meshes.insert(index, handle);
    }

    let scene = match document.scenes().nth(0) {
        Some(scene) => scene,
        None => bail!("No scenes found in the glTF file"),
    };

    let mut nodes = vec![];
    for node in scene.nodes() {
        nodes.extend(read_node(node, None, &meshes));
    }

    let name = Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string();
    log::debug!(
        "Read glTF scene {:?} -> {} node(s), {} mesh(es), {} texture(s), {} material(s)",
        name,
        nodes.len(),
        meshes.len(),
        textures.len(),
        materials.len(),
    );
    Ok(SceneDesc { name, nodes })
}

fn read_node(
    node: gltf::Node,
    parent: Option<usize>,
    meshes: &HashMap<usize, MeshHandle>,
) -> Vec<NodeDesc> {
    let mut nodes = vec![];
    let transform = match node.transform() {
        Transform::Matrix { matrix } => Mat4::from_cols_array_2d(&matrix),
        Transform::Decomposed {
            translation,
            rotation,
            scale,
        } => {
            let translation = Mat4::from_translation(Vec3::from(translation));
            let rotation = Mat4::from_quat(glam::Quat::from_array(rotation));
            let scale = Mat4::from_scale(Vec3::from(scale));
            translation * rotation * scale
        }
    };
    let index = node.index();
    let children = node.children().map(|n| n.index()).collect::<Vec<_>>();
    let name = match node.name() {
        Some(name) => format!("glTF-{index:02}-{}", name),
        None => format!("glTF-{index:02}"),
    };
    let mesh = node.mesh().and_then(|m| meshes.get(&m.index())).map(|h| *h);
    let data = if let Some(mesh) = mesh {
        NodeData::Mesh(mesh)
    } else {
        NodeData::Group
    };

    let desc = NodeDesc {
        name: name.clone(),
        index,
        parent,
        children,
        transform,
        mesh,
        data,
    };
    log::debug!("Read glTF node {} -> {:?}", index, desc);
    nodes.push(desc);

    for child in node.children() {
        nodes.extend(read_node(child, Some(index), meshes));
    }

    nodes
}

fn load_texture(
    data: &gltf::image::Data,
    info: &gltf::Texture,
    sampler: SamplerDesc,
    srgb: bool,
    assets: &mut Assets,
) -> Result<TextureHandle> {
    let index = info.index();
    let name = match info.name() {
        Some(name) => format!("tx-glTF-{index:03}-{name}",),
        None => format!("tx-glTF-{index:03}"),
    };
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

    let texture_handle = assets.add_texture(TextureDesc {
        name: name.to_string(),
        extent,
        format,
        usage: ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
        aspect: vk::ImageAspectFlags::COLOR,
        data: bytes.clone(),
        sampler,
    });

    Ok(texture_handle)
}

fn load_material(
    material: &gltf::Material,
    textures: &HashMap<usize, TextureHandle>,
    assets: &mut Assets,
) -> Result<MaterialHandle> {
    let index = match material.index() {
        Some(index) => index,
        None => bail!("Material index not found"),
    };
    let name = match material.name() {
        Some(name) => format!("mat-glTF-{index:03}-{name}"),
        None => format!("mat-glTF-{index:03}"),
    };
    let pbr = material.pbr_metallic_roughness();
    let base_index = pbr.base_color_texture().map(|i| i.texture().index());
    let base_handle = base_index.and_then(|i| textures.get(&i)).map(|h| *h);
    let normal_index = material.normal_texture().map(|i| i.texture().index());
    let normal_handle = normal_index.and_then(|i| textures.get(&i)).map(|h| *h);
    let ao_index = material.occlusion_texture().map(|i| i.texture().index());
    let ao_handle = ao_index.and_then(|i| textures.get(&i)).map(|h| *h);
    let mr_index = pbr
        .metallic_roughness_texture()
        .map(|i| i.texture().index());
    let mr_handle = mr_index.and_then(|i| textures.get(&i)).map(|h| *h);

    let base_color = Vec4::from_array(pbr.base_color_factor());
    let metallic_factor = pbr.metallic_factor();
    let roughness_factor = pbr.roughness_factor();
    let ao_strength = material.occlusion_texture().map_or(0.0, |i| i.strength());

    log::debug!("  Material {index} -> {name}");
    log::debug!("    Base texture -> handle: {base_handle:?} (index: {base_index:?})");
    log::debug!("    Normal texture -> handle: {normal_handle:?} (index: {normal_index:?})");
    log::debug!("    MetallicRoughness texture -> handle: {mr_handle:?} (index: {mr_index:?})");
    log::debug!("    AO texture -> handle: {ao_handle:?} (index: {ao_index:?})");
    log::debug!("    Base color -> {:?}", base_color);
    log::debug!("    Metallic factor -> {:?}", metallic_factor);
    log::debug!("    Roughness factor -> {:?}", roughness_factor);
    log::debug!("    AO strength -> {:?}", ao_strength);

    assets.add_material(Material {
        name,
        base_texture: base_handle,
        base_color,
        normal_texture: normal_handle,
        metallic_roughness_texture: mr_handle,
        metallic_factor,
        roughness_factor,
        ao_texture: ao_handle,
        ao_strength,
    })
}

fn load_mesh(
    source: &gltf::Mesh,
    buffers: &Vec<gltf::buffer::Data>,
    materials: &HashMap<usize, MaterialHandle>,
    assets: &mut Assets,
) -> Result<MeshHandle> {
    let name = {
        let index = source.index();
        let base = format!("mesh-glTF-{index:03}");
        source
            .name()
            .map(|name| format!("{base}-{name}"))
            .unwrap_or(base)
    };
    let mut primitives = vec![];
    for (i, primitive) in source.primitives().enumerate() {
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
                    normal: *normals.get(index).unwrap_or(&Vec3::ONE),
                    uv_x: uv.x,
                    uv_y: uv.y,
                    tangent: *tangents.get(index).unwrap_or(&Vec4::ONE),
                    color: *colors.get(index).unwrap_or(&Vec4::ONE),
                }
            })
            .collect();
        let indices = reader
            .read_indices()
            .map(|read_indices| read_indices.into_u32().collect::<Vec<_>>())
            .unwrap();

        let material_handle = primitive
            .material()
            .index()
            .and_then(|i| materials.get(&i))
            .map(|h| *h);
        let n_vertices = vertices.len() as u64;

        let topology = match primitive.mode() {
            gltf::mesh::Mode::Points => PrimitiveTopology::POINT_LIST,
            gltf::mesh::Mode::Lines => PrimitiveTopology::LINE_LIST,
            gltf::mesh::Mode::LineStrip => PrimitiveTopology::LINE_STRIP,
            gltf::mesh::Mode::Triangles => PrimitiveTopology::TRIANGLE_LIST,
            gltf::mesh::Mode::TriangleStrip => PrimitiveTopology::TRIANGLE_STRIP,
            gltf::mesh::Mode::LineLoop => PrimitiveTopology::LINE_STRIP,
            gltf::mesh::Mode::TriangleFan => PrimitiveTopology::TRIANGLE_FAN,
        };
        let has_vertex_normals = reader.read_normals().is_some();
        let has_tangents = reader.read_tangents().is_some();
        let n_indices = indices.len();

        primitives.push(PrimitiveDesc::new(
            vertices,
            indices,
            material_handle,
            topology,
            has_vertex_normals,
            has_tangents,
        ));

        log::debug!("  Primitive {i} -> {n_vertices} vertices, {n_indices} indices");
    }

    assets.load_mesh(MeshDesc {
        name,
        index: source.index(),
        primitives,
    })
}

fn load_sampler(sampler: gltf::texture::Sampler) -> SamplerDesc {
    use gltf::texture::{MagFilter, MinFilter, WrappingMode};
    let index = sampler.index().unwrap_or(usize::MAX);
    let min_filter = match sampler.min_filter() {
        Some(MinFilter::Nearest) => Filter::NEAREST,
        Some(MinFilter::NearestMipmapNearest) => Filter::NEAREST,
        Some(MinFilter::NearestMipmapLinear) => Filter::NEAREST,
        Some(MinFilter::Linear) => Filter::LINEAR,
        Some(MinFilter::LinearMipmapNearest) => Filter::LINEAR,
        Some(MinFilter::LinearMipmapLinear) => Filter::LINEAR,
        None => Filter::LINEAR,
    };
    let mag_filter = match sampler.mag_filter() {
        Some(MagFilter::Nearest) => Filter::NEAREST,
        Some(MagFilter::Linear) => Filter::LINEAR,
        None => Filter::LINEAR,
    };
    let address_mode_u = match sampler.wrap_s() {
        WrappingMode::ClampToEdge => SamplerAddressMode::CLAMP_TO_EDGE,
        WrappingMode::MirroredRepeat => SamplerAddressMode::MIRRORED_REPEAT,
        WrappingMode::Repeat => SamplerAddressMode::REPEAT,
    };
    let address_mode_y = match sampler.wrap_t() {
        WrappingMode::ClampToEdge => SamplerAddressMode::CLAMP_TO_EDGE,
        WrappingMode::MirroredRepeat => SamplerAddressMode::MIRRORED_REPEAT,
        WrappingMode::Repeat => SamplerAddressMode::REPEAT,
    };
    let mipmap_mode = match sampler.min_filter() {
        Some(MinFilter::Nearest) => SamplerMipmapMode::NEAREST,
        Some(MinFilter::NearestMipmapNearest) => SamplerMipmapMode::NEAREST,
        Some(MinFilter::NearestMipmapLinear) => SamplerMipmapMode::NEAREST,
        Some(MinFilter::Linear) => SamplerMipmapMode::LINEAR,
        Some(MinFilter::LinearMipmapNearest) => SamplerMipmapMode::LINEAR,
        Some(MinFilter::LinearMipmapLinear) => SamplerMipmapMode::LINEAR,
        _ => SamplerMipmapMode::LINEAR,
    };
    let name = match sampler.name() {
        Some(name) => format!("gltf-sampler-{index:02}-{name}"),
        None => format!("gltf-sampler-{index:02}"),
    };

    SamplerDesc {
        name,
        index,
        min_filter,
        mag_filter,
        mipmap_mode,
        address_mode_u,
        address_mode_v: address_mode_y,
        anisotropy_enable: false,
        max_anisotropy: 1.0,
    }
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
