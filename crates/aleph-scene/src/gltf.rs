use {
    crate::{
        graph::NodeHandle,
        model::{MeshInfo, PrimitiveInfo, VertexAttribute},
        util, Assets, Material, MaterialHandle, MeshHandle, Node, NodeType, Scene, TextureHandle,
        Vertex,
    },
    aleph_vk::{Extent2D, ImageAspectFlags, ImageUsageFlags, PrimitiveTopology, TextureInfo},
    anyhow::{anyhow, bail, Result},
    ash::vk,
    glam::{Mat4, Vec2, Vec3, Vec4},
    gltf::Semantic,
};

pub fn load_scene(path: &str, mut assets: &mut Assets) -> Result<Scene> {
    log::info!("Loading glTF scene from {path:?}");
    let (document, buffers, images) = gltf::import(path)?;

    let srgb: Vec<usize> = document
        .materials()
        .filter_map(|m| m.pbr_metallic_roughness().base_color_texture())
        .map(|t| t.texture().index())
        .collect();

    let textures = document
        .textures()
        .map(|texture| {
            let srgb = srgb.contains(&texture.index());
            let data = &images[texture.source().index()];
            load_texture(&data, &texture, srgb, &mut assets)
        })
        .collect::<Result<Vec<_>>>()?;
    log::info!("Loaded {} texture(s) ({} srgb)", textures.len(), srgb.len());

    let materials = document
        .materials()
        .map(|material| load_material(&material, &textures, &mut assets))
        .collect::<Result<Vec<_>>>()?;
    log::info!("Loaded {} material(s)", materials.len());

    let meshes = document
        .meshes()
        .map(|mesh| load_mesh(&mesh, &buffers, &materials, &mut assets))
        .collect::<Result<Vec<_>>>()?;

    log::info!("Loaded {} mesh(es)", meshes.len());

    let mut scene = Scene::default();
    let gltf_scene = document
        .default_scene()
        .ok_or_else(|| anyhow!("No scene found in glTF file"))?;

    for gltf_node in gltf_scene.nodes() {
        load_node(gltf_node, scene.root, &mut scene, &meshes)?;
    }
    log::info!("Finished loading scene from {path:?}");
    Ok(scene)
}

fn load_node(
    source: gltf::Node,
    parent: NodeHandle,
    scene: &mut Scene,
    meshes: &Vec<MeshHandle>,
) -> Result<()> {
    let parent_transform = scene
        .node(parent)
        .map(|p| p.transform)
        .unwrap_or(Mat4::IDENTITY);
    let matrix = source.transform().matrix();
    let transform = parent_transform * Mat4::from_cols_array_2d(&matrix);

    let index = source.index();
    let name = match source.name() {
        Some(name) => format!("glTF{:02}-{name}", source.index()),
        None => format!("glTF{:02}", source.index()),
    };

    let data = if let Some(mesh) = source.mesh() {
        let mesh_handle = meshes[mesh.index()];
        NodeType::Mesh(mesh_handle)
    } else {
        NodeType::Group
    };

    let handle = NodeHandle::next();
    let node = Node {
        handle,
        name: name.clone(),
        transform,
        local_transform: transform,
        data,
    };

    log::info!(
        "Loaded glTF node #{:02} -> {:?} (parent: {:?}, children: {:?})",
        index,
        &handle,
        parent,
        source.children().count()
    );

    scene.attach(node, parent)?;
    for child in source.children() {
        load_node(child, handle, scene, meshes)?;
    }

    Ok(())
}

fn load_texture(
    data: &gltf::image::Data,
    source: &gltf::Texture,
    srgb: bool,
    assets: &mut Assets,
) -> Result<TextureHandle> {
    let index = source.index();
    let name = match source.name() {
        Some(name) => format!("glTF{index:03}-{name}",),
        None => format!("glTF{index:03}"),
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

    let handle = assets.add_texture(TextureInfo {
        name: name.to_string(),
        extent,
        format,
        data: bytes.clone(),
        sampler: Some(assets.defaults.sampler),
        flags: ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
        aspect_flags: ImageAspectFlags::COLOR,
    });

    log::info!("Loaded glTF texture {index} -> {handle:?}");

    Ok(handle)
}

fn load_material(
    material: &gltf::Material,
    textures: &Vec<TextureHandle>,
    assets: &mut Assets,
) -> Result<MaterialHandle> {
    let index = match material.index() {
        Some(index) => index,
        None => bail!("Material index not found"),
    };
    let name = match material.name() {
        Some(name) => format!("glTF-{index:03}-{name}"),
        None => format!("glTF-{index:03}"),
    };
    let pbr = material.pbr_metallic_roughness();
    let color_texture = pbr
        .base_color_texture()
        .map(|i| textures[i.texture().index()]);
    let normal_texture = material
        .normal_texture()
        .map(|i| textures[i.texture().index()]);
    let ao_texture = material
        .occlusion_texture()
        .map(|i| textures[i.texture().index()]);
    let metalrough_texture = pbr
        .metallic_roughness_texture()
        .map(|i| textures[i.texture().index()]);

    let color_factor = Vec4::from_array(pbr.base_color_factor());
    let metallic_factor = pbr.metallic_factor();
    let roughness_factor = pbr.roughness_factor();
    let ao_strength = material.occlusion_texture().map_or(0.0, |i| i.strength());

    let handle = assets.add_material(Material {
        name,
        color_texture,
        color_factor,
        normal_texture,
        metalrough_texture,
        metallic_factor,
        roughness_factor,
        ao_texture,
        ao_strength,
    })?;

    log::debug!("Loaded glTF material #{index} -> {handle:?}");
    log::debug!("  -> Color texture: {color_texture:?}");
    log::debug!("  -> Color factor: {color_factor:?}");
    log::debug!("  -> Normal texture: {normal_texture:?}");
    log::debug!("  -> MetalRough texture: {metalrough_texture:?}");
    log::debug!("  -> Metallic factor: {metallic_factor:?}");
    log::debug!("  -> Roughness factor: {roughness_factor:?}");
    log::debug!("  -> AO texture: {ao_texture:?}");
    log::debug!("  -> AO strength: {ao_strength:?}");

    Ok(handle)
}

fn load_mesh(
    source: &gltf::Mesh,
    buffers: &Vec<gltf::buffer::Data>,
    materials: &Vec<MaterialHandle>,
    assets: &mut Assets,
) -> Result<MeshHandle> {
    let index = source.index();
    let name = match source.name() {
        Some(name) => format!("glTF-{index:03}-{name}"),
        None => format!("glTF-{index:03}"),
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

        let material = primitive
            .material()
            .index()
            .and_then(|i| materials.get(i))
            .map(|h| *h);

        let attributes: Vec<VertexAttribute> = primitive
            .attributes()
            .filter_map(|a| match a {
                (Semantic::Positions, _) => Some(VertexAttribute::Position),
                (Semantic::Normals, _) => Some(VertexAttribute::Normal),
                (Semantic::Tangents, _) => Some(VertexAttribute::Tangent),
                (Semantic::TexCoords(0), _) => Some(VertexAttribute::TexCoord0),
                (Semantic::TexCoords(1), _) => Some(VertexAttribute::TexCoord1),
                (Semantic::Colors(0), _) => Some(VertexAttribute::Color),
                _ => None,
            })
            .collect();

        let topology = match primitive.mode() {
            gltf::mesh::Mode::Points => PrimitiveTopology::POINT_LIST,
            gltf::mesh::Mode::Lines => PrimitiveTopology::LINE_LIST,
            gltf::mesh::Mode::LineStrip => PrimitiveTopology::LINE_STRIP,
            gltf::mesh::Mode::Triangles => PrimitiveTopology::TRIANGLE_LIST,
            gltf::mesh::Mode::TriangleStrip => PrimitiveTopology::TRIANGLE_STRIP,
            gltf::mesh::Mode::LineLoop => PrimitiveTopology::LINE_STRIP,
            gltf::mesh::Mode::TriangleFan => PrimitiveTopology::TRIANGLE_FAN,
        };

        let desc = PrimitiveInfo::new(vertices, indices, material, topology, attributes);
        log::debug!("Loaded glTF mesh #{index} primitive #{i} -> {desc:?}");

        primitives.push(desc);
    }

    log::debug!(
        "Loaded glTF mesh #{} -> {} (primitives:{})",
        index,
        name,
        primitives.len(),
    );
    assets.add_mesh(MeshInfo { name, primitives })
}

// fn load_sampler(sampler: gltf::texture::Sampler, assets: &mut Assets) -> Sampler {
//     use gltf::texture::{MagFilter, MinFilter, WrappingMode};
//     let index = sampler.index().unwrap_or(usize::MAX);
//     let min_filter = match sampler.min_filter() {
//         Some(MinFilter::Nearest) => Filter::NEAREST,
//         Some(MinFilter::NearestMipmapNearest) => Filter::NEAREST,
//         Some(MinFilter::NearestMipmapLinear) => Filter::NEAREST,
//         Some(MinFilter::Linear) => Filter::LINEAR,
//         Some(MinFilter::LinearMipmapNearest) => Filter::LINEAR,
//         Some(MinFilter::LinearMipmapLinear) => Filter::LINEAR,
//         None => Filter::LINEAR,
//     };
//     let mag_filter = match sampler.mag_filter() {
//         Some(MagFilter::Nearest) => Filter::NEAREST,
//         Some(MagFilter::Linear) => Filter::LINEAR,
//         None => Filter::LINEAR,
//     };
//     let address_mode_u = match sampler.wrap_s() {
//         WrappingMode::ClampToEdge => SamplerAddressMode::CLAMP_TO_EDGE,
//         WrappingMode::MirroredRepeat => SamplerAddressMode::MIRRORED_REPEAT,
//         WrappingMode::Repeat => SamplerAddressMode::REPEAT,
//     };
//     let address_mode_y = match sampler.wrap_t() {
//         WrappingMode::ClampToEdge => SamplerAddressMode::CLAMP_TO_EDGE,
//         WrappingMode::MirroredRepeat => SamplerAddressMode::MIRRORED_REPEAT,
//         WrappingMode::Repeat => SamplerAddressMode::REPEAT,
//     };
//     let mipmap_mode = match sampler.min_filter() {
//         Some(MinFilter::Nearest) => SamplerMipmapMode::NEAREST,
//         Some(MinFilter::NearestMipmapNearest) => SamplerMipmapMode::NEAREST,
//         Some(MinFilter::NearestMipmapLinear) => SamplerMipmapMode::NEAREST,
//         Some(MinFilter::Linear) => SamplerMipmapMode::LINEAR,
//         Some(MinFilter::LinearMipmapNearest) => SamplerMipmapMode::LINEAR,
//         Some(MinFilter::LinearMipmapLinear) => SamplerMipmapMode::LINEAR,
//         _ => SamplerMipmapMode::LINEAR,
//     };
//     let name = match sampler.name() {
//         Some(name) => format!("gltf-sampler-{index:02}-{name}"),
//         None => format!("gltf-sampler-{index:02}"),
//     };
// }
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
// }                                                                                                                             cr
