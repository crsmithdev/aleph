use {
    crate::{
        scene::{
            material::Material,
            model::{Mesh, Primitive, Vertex},
            util, Node, NodeData, Scene,
        },
        vk::{Extent2D, Gpu, ImageUsageFlags, Texture},
    }, anyhow::{bail, Result}, ash::vk, derive_more::Debug, glam::{Mat4, Vec2, Vec3, Vec4}, itertools::Itertools, std::{
        collections::{HashMap, HashSet},
        mem::size_of,
        path::Path,
    }
};

pub type Graph = petgraph::Graph<Node, ()>;

#[derive(Debug)]
pub struct GltfScene {
    pub document: gltf::Document,
    pub buffers: Vec<gltf::buffer::Data>,
    pub images: Vec<gltf::image::Data>,
}

// #[derive(Debug)]
// pub struct SceneDesc {
//     pub roots: Vec<usize>,
//     pub nodes: Vec<NodeDesc>,
// }

const GLTF_SAMPLE_DIR: &str = "assets/gltf/glTF-Sample-Assets";
const GLTF_VALIDATION_DIR: &str = "assets/gltf/glTF-Asset-Generator";

pub fn sample_path(name: &str) -> Result<String> {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(GLTF_SAMPLE_DIR)
        .join(name)
        .join("glTF")
        .join(format!("{name}.gltf"))
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| anyhow::anyhow!(e))
}

fn add_node(
    gpu: &Gpu,
    graph: &mut Graph,
    src: gltf::Node,
    parent_transform: Mat4,
    meshes: &HashMap<usize, Mesh>,
) {
    let transform = Mat4::from_cols_array_2d(&src.transform().matrix()) * parent_transform;
    let index = src.index();
    let name = match src.name() {
        Some(name) => format!("gltf-node{index}-{}", name),
        None => format!("gltf-node{index}"),
    };
    let data = match src.mesh() {
        Some(mesh) => NodeData::Mesh(mesh.index()),
        None => NodeData::Empty,
    };

    graph.add_node(Node {
        name,
        transform,
        data,
    });

    for child in src.children() {
        add_node(gpu, graph, child, transform, meshes);
    }
}

pub fn load(gpu: &Gpu, path: &str) -> Result<Scene> {
    let (document, buffers, images) = gltf::import(path)?;

    let mut srgb_textures = HashSet::new();
    for material in document.materials() {
        let pbr = material.pbr_metallic_roughness();
        if let Some(info) = pbr.base_color_texture() {
            srgb_textures.insert(info.texture().index());
        }
    }

    let mut textures: HashMap<usize, Texture> = HashMap::new();
    for index in 0..document.textures().len() {
        let info = document.textures().nth(index).unwrap();
        let srgb = srgb_textures.contains(&index);
        let data = &images[info.source().index()];
        let name = match info.name() {
            Some(name) => format!("gltf-{index:02}-{name}",),
            None => format!("gltf-{index:02}"),
        };
        let sampler = load_sampler(gpu, info.sampler())?;
        let texture = load_texture(gpu, &data, &name, sampler, srgb)?;
        textures.insert(index, texture);
    }
    let textures = textures.into_iter().sorted_by_key(|t| t.0).map(|t| t.1).collect::<Vec<_>>();

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

    let mut root = Graph::new();
    let scene = match document.scenes().nth(0) {
        Some(scene) => scene,
        None => bail!("No scenes found in the glTF file"),
    };

    for node in scene.nodes() {
        add_node(gpu, &mut root, node, Mat4::IDENTITY, &meshes);
    }
    let meshes = meshes.into_iter().sorted_by_key(|t| t.0).map(|t| t.1).collect::<Vec<_>>();

    Ok(Scene {
        root,
        materials,
        textures,
        meshes,
    })
}

fn load_texture(
    gpu: &Gpu,
    data: &gltf::image::Data,
    name: &str,
    sampler: vk::Sampler,
    srgb: bool,
) -> Result<Texture> {
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

    let image = gpu.create_image(
        extent,
        format,
        vk::ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
        vk::ImageAspectFlags::COLOR,
        name,
        Some(sampler),
    )?;

    let staging = util::staging_buffer(gpu, &bytes, name)?;

    gpu.execute(|cmd| {
        cmd.copy_buffer_to_image(&staging, &image);
    })?;

    log::debug!("Loaded texture: {} ({:?}, srgb:{})", &name, format, srgb);
    Ok(image)
}

fn load_material(material: &gltf::Material) -> Result<Material> {
    let name = format!(
        "gltf-material-{:02}-{}",
        material.index().expect("material index"),
        material.name().unwrap_or("unnamed")
    );
    let pbr = material.pbr_metallic_roughness();
    let base_texture = pbr.base_color_texture().map(|i| i.texture().index());
    let normal_texture = material.normal_texture().map(|i| i.texture().index());
    let metallic_roughness_texture = pbr
        .metallic_roughness_texture()
        .map(|i| i.texture().index());
    let occlusion_texture = material.occlusion_texture().map(|i| i.texture().index());

    let base_color = Vec4::from_array(pbr.base_color_factor());
    let metallic_factor = pbr.metallic_factor();
    let roughness_factor = pbr.roughness_factor();
    let occlusion_factor = material.occlusion_texture().map_or(0.0, |i| i.strength());

    Ok(Material {
        name,
        base_texture: base_texture,
        base_color,
        color_sampler: None,
        normal_texture: normal_texture,
        normal_sampler: None,
        metallic_roughness_texture,
        metallic_factor,
        roughness_factor,
        occlusion_texture,
        occlusion_sampler: None,
        occlusion_factor,
        metallic_roughness_sampler: None,
    })
}

fn load_mesh(gpu: &Gpu, source: &gltf::Mesh, buffers: &Vec<gltf::buffer::Data>) -> Result<Mesh> {
    let mesh_name = {
        let index = source.index();
        let base = format!("gltf-mesh{index:02}");
        source
            .name()
            .map(|name| format!("{base}-{name}"))
            .unwrap_or(base)
    };
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

        let mut vertices: Vec<Vertex> = positions
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
                    normal_derived: Vec3::ZERO,
                    _padding: 0.0,
                }
            })
            .collect();
        let indices = reader
            .read_indices()
            .map(|read_indices| read_indices.into_u32().collect::<Vec<_>>())
            .unwrap();

        let normals = util::calculate_normals(&vertices, &indices).to_vec();
        for i in 0..vertices.len() {
            vertices[i].normal_derived = normals[i];
        }

        let index_buffer_size = size_of::<u32>() as u64 * indices.len() as u64;
        let index_buffer = util::index_buffer(gpu, index_buffer_size, "index buffer")?;
        let index_staging = util::staging_buffer(gpu, &indices, "index staging")?;

        let vertex_buffer_size = size_of::<Vertex>() as u64 * vertices.len() as u64;
        let vertex_buffer = util::vertex_buffer(gpu, vertex_buffer_size, "vertex buffer")?;
        let vertex_staging = util::staging_buffer(gpu, &vertices, "vertex staging")?;

        gpu.execute(|cmd| {
            cmd.copy_buffer(&vertex_staging, &vertex_buffer, vertex_buffer.size());
            cmd.copy_buffer(&index_staging, &index_buffer, index_buffer.size());
        })?;

        let material_idx = primitive.material().index();

        primitives.push(Primitive {
            vertex_buffer,
            index_buffer,
            material_idx,
            vertex_count: indices.len() as u32,
        });
    }

    Ok(Mesh {
        name: mesh_name,
        primitives,
    })
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
    gpu.create_sampler(
        min_filter,
        mag_filter,
        mipmap_mode,
        address_mode_u,
        address_mode_y,
    )
}
#[cfg(test)]
mod tests {
    use std::{cell::LazyCell, sync::Arc};

    use super::*;
    fn test_gpu() -> Gpu {
        use {
            std::sync::Arc,
            winit::{
                event_loop::EventLoop, platform::windows::EventLoopBuilderExtWindows,
                window::WindowAttributes,
            },
        };

        let event_loop = {
            EventLoop::builder()
                .with_any_thread(true)
                .build()
                .expect("error creating test event loop")
        };
        let mut attributes = WindowAttributes::default();
        attributes.visible = false;

        #[allow(deprecated)]
        let window = event_loop.create_window(attributes).unwrap();

        Gpu::new(Arc::new(window)).expect("error initializing test gpu")
    }

    #[test]
    fn test_load_minimal() {

        let path = sample_path("Box").expect("path");
        let result = load(&test_gpu(), &path);
        println!("Result: {:?}", result);
        assert!(result.is_ok());

        let scene = result.unwrap();
        assert_eq!(scene.root.node_count(), 2);
        assert_eq!(scene.materials.len(), 1);
        assert_eq!(scene.nodes().len(), 2);
        assert_eq!(scene.textures.len(), 0);
        assert_eq!(scene.meshes.len(), 1);
        assert_eq!(scene.meshes[0].primitives.len(), 1);
        assert_eq!(scene.meshes[0].primitives[0].vertex_count, 36);
    }

    fn test_load_suzanne() {
        let path = sample_path("Suzanne").expect("path");
        let result = load(&test_gpu(), &path);
        println!("Result: {:?}", result);
        assert!(result.is_ok());

        let scene = result.unwrap();
        assert_eq!(scene.root.node_count(), 2);
        assert_eq!(scene.materials.len(), 1);
    }
}
