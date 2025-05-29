use {
    crate::{
        graph::{NodeData, NodeHandle},
        model::MeshInfo,
        util, Assets, Material, MaterialHandle, MeshHandle, Node, Scene, TextureHandle,
    },
    aleph_vk::{
        Extent2D, Filter, Format, ImageAspectFlags, ImageUsageFlags, PrimitiveTopology, Sampler,
        SamplerAddressMode, SamplerMipmapMode, TextureInfo,
    },
    anyhow::{anyhow, bail, Result},
    glam::{Mat4, Vec2, Vec3, Vec4},
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

    let materials = document
        .materials()
        .map(|material| load_material(&material, &textures, &mut assets))
        .collect::<Result<Vec<_>>>()?;

    let meshes = document
        .meshes()
        .flat_map(|mesh| load_mesh(&mesh, &buffers, &materials, &mut assets))
        .collect::<Vec<_>>();

    let mut scene = Scene::default();
    let gltf_scene =
        document.default_scene().ok_or_else(|| anyhow!("No scene found in glTF file"))?;

    for gltf_node in gltf_scene.nodes() {
        load_node(gltf_node, scene.root(), &mut scene, &meshes)?;
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
    let parent_transform = scene.node(parent).map(|p| p.world_transform).unwrap_or(Mat4::IDENTITY);
    let matrix = source.transform().matrix();
    let transform = parent_transform * Mat4::from_cols_array_2d(&matrix);

    let index = source.index();
    let name = match source.name() {
        Some(name) => format!("glTF{:02}-{name}", source.index()),
        None => format!("glTF{:02}", source.index()),
    };

    let data = if let Some(mesh) = source.mesh() {
        let mesh_handle = meshes[mesh.index()];
        NodeData::Mesh(mesh_handle)
    } else {
        NodeData::Group
    };

    let handle = NodeHandle::next();
    let node = Node {
        handle,
        name: name.clone(),
        world_transform: transform,
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

fn load_sampler(data: &gltf::texture::Sampler, assets: &mut Assets) -> Sampler {
    use gltf::texture::{MagFilter, MinFilter, WrappingMode};
    let index = data.index().unwrap_or(0);
    let min_filter = match data.min_filter() {
        Some(MinFilter::Nearest) => Filter::NEAREST,
        Some(MinFilter::NearestMipmapNearest) => Filter::NEAREST,
        Some(MinFilter::NearestMipmapLinear) => Filter::NEAREST,
        Some(MinFilter::Linear) => Filter::LINEAR,
        Some(MinFilter::LinearMipmapNearest) => Filter::LINEAR,
        Some(MinFilter::LinearMipmapLinear) => Filter::LINEAR,
        None => Filter::LINEAR,
    };
    let mag_filter = match data.mag_filter() {
        Some(MagFilter::Nearest) => Filter::NEAREST,
        Some(MagFilter::Linear) => Filter::LINEAR,
        None => Filter::LINEAR,
    };
    let address_mode_u = match data.wrap_s() {
        WrappingMode::ClampToEdge => SamplerAddressMode::CLAMP_TO_EDGE,
        WrappingMode::MirroredRepeat => SamplerAddressMode::MIRRORED_REPEAT,
        WrappingMode::Repeat => SamplerAddressMode::REPEAT,
    };
    let address_mode_v = match data.wrap_t() {
        WrappingMode::ClampToEdge => SamplerAddressMode::CLAMP_TO_EDGE,
        WrappingMode::MirroredRepeat => SamplerAddressMode::MIRRORED_REPEAT,
        WrappingMode::Repeat => SamplerAddressMode::REPEAT,
    };
    let mipmap_mode = match data.min_filter() {
        Some(MinFilter::Nearest) => SamplerMipmapMode::NEAREST,
        Some(MinFilter::NearestMipmapNearest) => SamplerMipmapMode::NEAREST,
        Some(MinFilter::NearestMipmapLinear) => SamplerMipmapMode::NEAREST,
        Some(MinFilter::Linear) => SamplerMipmapMode::LINEAR,
        Some(MinFilter::LinearMipmapNearest) => SamplerMipmapMode::LINEAR,
        Some(MinFilter::LinearMipmapLinear) => SamplerMipmapMode::LINEAR,
        None => SamplerMipmapMode::LINEAR,
    };

    let sampler = assets.create_sampler(
        &format!("gltf-sampler{index:02}"),
        min_filter,
        mag_filter,
        mipmap_mode,
        address_mode_u,
        address_mode_v,
    );

    log::info!("Loaded glTF sampler {index} -> {sampler:?}");

    sampler
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
        true => Format::R8G8B8A8_SRGB,
        false => Format::R8G8B8A8_UNORM,
    };

    let sampler = load_sampler(&source.sampler(), assets);

    let handle = assets.add_texture(
        TextureInfo {
            name: name,
            extent,
            format,
            flags: ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
            sampler: Some(sampler),
            aspect_flags: ImageAspectFlags::COLOR,
        },
        &bytes,
    );

    log::info!("Loaded glTF texture {index} -> {handle:?} ({format:?})");

    Ok(handle)
}

fn load_material(
    gltf_material: &gltf::Material,
    textures: &Vec<TextureHandle>,
    assets: &mut Assets,
) -> Result<MaterialHandle> {
    let index = match gltf_material.index() {
        Some(index) => index,
        None => bail!("Material index not found"),
    };
    let name = match gltf_material.name() {
        Some(name) => format!("glTF-{index:03}-{name}"),
        None => format!("glTF-{index:03}"),
    };
    let pbr = gltf_material.pbr_metallic_roughness();
    let color_texture = pbr
        .base_color_texture()
        .map(|info| textures[info.texture().index()])
        .unwrap_or(TextureHandle::null());
    let normal_texture = gltf_material
        .normal_texture()
        .map(|info| textures[info.texture().index()])
        .unwrap_or(TextureHandle::null());
    let metalrough_texture = pbr
        .metallic_roughness_texture()
        .map(|info| textures[info.texture().index()])
        .unwrap_or(TextureHandle::null());
    let ao_texture = gltf_material
        .occlusion_texture()
        .map(|info| textures[info.texture().index()])
        .unwrap_or(TextureHandle::null());
    let ao_strength = gltf_material.occlusion_texture().map_or(1.0, |i| i.strength());

    let material = Material {
        color_texture,
        metalrough_texture,
        normal_texture,
        occlusion_texture: ao_texture,
        ao_strength,
        color_factor: Vec4::from_array(pbr.base_color_factor()),
        metallic_factor: pbr.metallic_factor(),
        roughness_factor: pbr.roughness_factor(),
        name: name.clone(),
    };

    let handle = assets.add_material(material.clone());

    log::debug!("Loaded {handle:?} -> {material:?}");

    Ok(handle)
}

fn load_mesh(
    source: &gltf::Mesh,
    buffers: &Vec<gltf::buffer::Data>,
    materials: &Vec<MaterialHandle>,
    assets: &mut Assets,
) -> Vec<MeshHandle> {
    let mesh_index = source.index();
    let mut handles = vec![];

    for (primitive_index, primitive) in source.primitives().enumerate() {
        let reader = primitive.reader(|buffer| Some(&buffers[buffer.index()]));

        let vertices = reader
            .read_positions()
            .map_or(Vec::new(), |positions| positions.map(Vec3::from).collect());
        let normals =
            reader.read_normals().map_or(Vec::new(), |normals| normals.map(Vec3::from).collect());
        let tex_coords0 = reader.read_tex_coords(0).map_or(Vec::new(), |coords| -> Vec<Vec2> {
            coords.into_f32().map(Vec2::from).collect()
        });
        let tangents = reader
            .read_tangents()
            .map_or(Vec::new(), |tangents| tangents.map(Vec4::from).collect());
        let colors = reader.read_colors(0).map_or(Vec::new(), |colors| {
            colors.into_rgba_f32().map(Vec4::from).collect::<Vec<_>>()
        });

        let indices = reader.read_indices().map(|idx| idx.into_u32().collect::<Vec<_>>()).unwrap();

        let material = match primitive.material().index() {
            Some(index) => materials[index],
            None => MaterialHandle::null(),
        };

        let topology = match primitive.mode() {
            gltf::mesh::Mode::Points => PrimitiveTopology::POINT_LIST,
            gltf::mesh::Mode::Lines => PrimitiveTopology::LINE_LIST,
            gltf::mesh::Mode::LineStrip => PrimitiveTopology::LINE_STRIP,
            gltf::mesh::Mode::Triangles => PrimitiveTopology::TRIANGLE_LIST,
            gltf::mesh::Mode::TriangleStrip => PrimitiveTopology::TRIANGLE_STRIP,
            gltf::mesh::Mode::LineLoop => PrimitiveTopology::LINE_STRIP,
            gltf::mesh::Mode::TriangleFan => PrimitiveTopology::TRIANGLE_FAN,
        };

        let name = format!("name{:02}-{:02}", mesh_index, primitive_index);
        let info = MeshInfo {
            indices,
            vertices,
            normals,
            tangents,
            colors,
            tex_coords0,
            material,
            name,
            topology,
        };
        log::debug!(
            "Loaded glTF mesh #{} primitive #{} -> {:?}",
            mesh_index,
            primitive_index,
            info,
        );

        let handle = assets.add_mesh(info);
        handles.push(handle);
    }
    handles
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
// }                                                                                                                             cr
