pub mod camera;
pub mod gltf2;
pub mod material;
pub mod model;
pub mod util;

use {
    crate::vk::{self, Extent2D, Filter, Gpu, ImageUsageFlags, SamplerMipmapMode, Texture},
    anyhow::Result,
    ash::vk::SamplerAddressMode,
    derive_more::Debug,
    glam::{Mat4, Vec4},
    gltf,
    petgraph::{
        graph::NodeIndex,
        visit::{Bfs, EdgeRef},
    },
    std::{collections::HashMap, mem::size_of},
    tracing::instrument,
};

pub use crate::scene::{
    camera::{Camera, CameraConfig},
    gltf2::{GltfDocument, MaterialDesc, PrimitiveDesc, SamplerDesc, TextureDesc},
    material::Material,
    model::{GpuDrawData, Mesh, Primitive, Vertex},
};

pub type Graph = petgraph::Graph<Node, ()>;

#[derive(Debug)]
pub enum NodeData {
    Mesh(Mesh),
    Empty,
}

#[derive(Debug)]
pub struct Node {
    pub transform: Mat4,
    pub data: NodeData,
}

pub struct TextureDefaults {
    pub white_srgb: Texture,
    pub black_srgb: Texture,
    pub black_linear: Texture,
    pub white_linear: Texture,
    pub normal: Texture,
    pub sampler: vk::Sampler,
}

pub struct Scene {
    pub graph: Graph,
    pub materials: Vec<Material>,
    pub default_material_idx: usize,
}
struct LoadContext<'a> {
    pub gpu: &'a Gpu,
    pub document: &'a gltf2::GltfDocument,
    pub buffers: Vec<gltf::buffer::Data>,
    pub images: Vec<gltf::image::Data>,
    pub texture_cache: Vec<Texture>,
    pub material_cache: Vec<Material>,
}

pub struct Model {
    meshes: Vec<Mesh>,
}

impl Scene {
    pub fn from_gltf2(context: &LoadContext) {}
}

impl Scene {
    pub fn from_gltf(gpu: &Gpu, document: &GltfDocument) -> Result<Scene> {
        let mut context = LoadContext {
            gpu,
            document,
            buffers: document.buffers.clone(),
            images: document.images.clone(),
            texture_cache: Vec::new(),
            material_cache: Vec::new(),
        };
        let defaults = load_default_textures(gpu)?;
        let materials = load_materials(&mut context, &defaults)?;
        let default_material_idx = materials.len() - 1;
        let root = load_graph(gpu, document)?;
        let scene = Scene {
            graph: root,
            materials,
            default_material_idx,
        };

        let lines = scene.display();
        for line in lines {
            log::debug!("{}", line);
        }

        Ok(scene)
    }

    pub fn display(&self) -> Vec<String> {
        let mut traversal = Bfs::new(&self.graph, NodeIndex::new(0));
        let mut lines = vec![];
        while let Some(index) = traversal.next(&self.graph) {
            let node = &self.graph[index];
            let (node_type, node_children) = match &node.data {
                NodeData::Mesh(mesh) => {
                    let node_children = format!("{} primitives", mesh.primitives.len());
                    ("Mesh", node_children)
                }
                NodeData::Empty => {
                    let edges = self.graph.edges(index);
                    let node_children = edges
                        .map(|edge| format!("{}", edge.target().index()))
                        .collect::<Vec<_>>()
                        .join(", ");
                    ("Empty", node_children)
                }
            };
            let line = format!(
                "[#{:?}] - {} ({})",
                index.index(),
                node_type,
                node.transform
            );
            lines.push(line);
            let line = format!("  -> {}", node_children);
            lines.push(line);
        }

        lines
    }
}

fn load_default_textures(gpu: &Gpu) -> Result<TextureDefaults> {
    let white_srgb = load_default(
        gpu,
        [255, 255, 255, 255],
        vk::Format::R8G8B8A8_SRGB,
        "default-white-srgb",
    )?;
    let black_srgb = load_default(
        gpu,
        [0, 0, 0, 255],
        vk::Format::R8G8B8A8_SRGB,
        "default-black-srgb",
    )?;
    let white_linear = load_default(
        gpu,
        [255, 255, 255, 255],
        vk::Format::R8G8B8A8_UNORM,
        "default-white-unorm",
    )?;
    let black_linear = load_default(
        gpu,
        [0, 0, 0, 255],
        vk::Format::R8G8B8A8_UNORM,
        "default-black-unorm",
    )?;
    let normal = load_default(
        gpu,
        [128, 128, 255, 255],
        vk::Format::R8G8B8A8_UNORM,
        "default-normal",
    )?;
    let sampler = gpu.create_sampler(
        Filter::LINEAR,
        Filter::LINEAR,
        SamplerMipmapMode::LINEAR,
        SamplerAddressMode::REPEAT,
        SamplerAddressMode::REPEAT,
    )?;
    Ok(TextureDefaults {
        white_srgb,
        white_linear,
        black_srgb,
        black_linear,
        normal,
        sampler,
    })
}

fn load_graph(gpu: &Gpu, document: &GltfDocument) -> Result<Graph> {
    let mut graph = Graph::new();
    let mut node_map = HashMap::new();
    let root = Node {
        transform: Mat4::IDENTITY,
        data: NodeData::Empty,
    };
    let root_index = graph.add_node(root);
    let scene = &document.scene;

    for (gltf_index, desc) in scene.nodes.iter().enumerate() {
        let transform = desc.transform;
        let data = if let Some(mesh_index) = desc.mesh {
            let mesh = load_mesh(gpu, document, mesh_index)?;
            NodeData::Mesh(mesh)
        } else {
            NodeData::Empty
        };

        let node = Node { transform, data };
        log::debug!("{} -> {:?}", gltf_index, node);
        let node_index = graph.add_node(node);
        node_map.insert(gltf_index, node_index);
    }

    for (gltf_index, desc) in scene.nodes.iter().enumerate() {
        let node_index = node_map[&gltf_index];
        log::debug!("{} -> {:?}", node_index.index(), desc.children);
        for child_gltf_index in &desc.children {
            let child_index = node_map[&child_gltf_index];
            if gltf_index != *child_gltf_index
                && node_index != child_index
                && child_index.index() != 0
            {
                graph.add_edge(node_index, child_index, ());
            }
        }
    }

    for idx in scene.roots.iter() {
        let node_index = node_map[&idx];
        graph.add_edge(root_index, node_index, ());
    }

    Ok(graph)
}

#[instrument(skip_all)]
fn load_materials(context: &mut LoadContext, defaults: &TextureDefaults) -> Result<Vec<Material>> {
    let gpu = context.gpu;
    let document = context.document;

    let default_material = load_default_material(gpu, defaults)?;
    let materials: Result<Vec<Material>> = document
        .materials
        .iter()
        .map(|desc| load_material(context, desc, defaults))
        .collect();
    let materials = materials?;

    let mut result = Vec::from(materials);
    result.push(default_material);
    Ok(result)
}

fn load_default_material(gpu: &Gpu, defaults: &TextureDefaults) -> Result<Material> {
    let sampler = gpu.create_sampler(
        Filter::LINEAR,
        Filter::LINEAR,
        SamplerMipmapMode::LINEAR,
        SamplerAddressMode::REPEAT,
        SamplerAddressMode::REPEAT,
    )?;
    Ok(Material {
        name: "default".to_string(),
        base_color_tx: defaults.white_srgb.clone(),
        base_color_sampler: defaults.sampler,
        normal_tx: defaults.white_linear.clone(),
        normal_sampler: sampler,
        metallic_roughness_tx: defaults.white_linear.clone(),
        metallic_factor: 1.0,
        roughness_factor: 1.0,
        occlusion_tx: defaults.white_linear.clone(),
        occlusion_sampler: sampler,
        metallic_roughness_sampler: sampler,
        base_color_factor: Vec4::new(1.0, 1.0, 1.0, 1.0),
    })
}

fn load_material(
    context: &mut LoadContext,
    desc: &MaterialDesc,
    defaults: &TextureDefaults,
) -> Result<Material> {
    log::debug!("Loading material {}", desc.name);

    let base_color_tx = match desc.base_color_tx {
        Some(index) => load_texture_cached(context, index, "base color", false)?,
        None => defaults.white_srgb.clone(),
    };

    let normal_tx = match desc.normal_texture {
        Some(index) => load_texture_cached(context, index, "normal", true)?,
        None => defaults.normal.clone(),
    };

    let occlusion_tx = match desc.occlusion_texture {
        Some(index) => load_texture_cached(context, index, "occlusion", false)?,
        None => defaults.white_linear.clone(),
    };

    let samplers = &context.document.samplers;
    let textures = &context.document.textures;
    let gpu = context.gpu;

    let metallic_roughness_tx = match desc.metallic_roughnness_texture {
        Some(index) => load_texture_cached(context, index, "metal_rough", false)?,
        None => defaults.white_linear.clone(),
    };

    let albedo_sampler = match desc.base_color_sampler {
        Some(idx) => load_sampler(gpu, &samplers[idx])?,
        None => defaults.sampler,
    };
    let normal_sampler = match desc.normal_sampler {
        Some(idx) => load_sampler(gpu, &samplers[idx])?,
        None => defaults.sampler,
    };
    let occlusion_sampler = match desc.occlusion_sampler {
        Some(idx) => load_sampler(gpu, &samplers[idx])?,
        None => defaults.sampler,
    };
    let metallic_roughness_sampler = match desc.metallic_roughness_sampler {
        Some(idx) => load_sampler(gpu, &samplers[idx])?,
        None => defaults.sampler,
    };

    let material = Material {
        name: desc.name.clone(),
        base_color_tx,
        base_color_sampler: albedo_sampler,
        normal_tx,
        normal_sampler,
        metallic_roughness_tx,
        metallic_factor: desc.metallic_factor,
        roughness_factor: desc.roughness_factor,
        occlusion_tx,
        occlusion_sampler,
        metallic_roughness_sampler,
        base_color_factor: desc.base_color_factor.into(),
    };

    log::debug!("Loaded material: {:?}", material.name);

    Ok(material)
}

fn load_texture(gpu: &Gpu, desc: &TextureDesc, format: vk::Format) -> Result<Texture> {
    let image = match desc.gltf_format {
        gltf::image::Format::R8G8B8A8 => image::DynamicImage::ImageRgba8(
            image::ImageBuffer::from_raw(desc.extent.width, desc.extent.height, desc.data.to_vec())
                .expect("raw"),
        ),
        gltf::image::Format::R8G8B8 => image::DynamicImage::ImageRgb8(
            image::ImageBuffer::from_raw(desc.extent.width, desc.extent.height, desc.data.to_vec())
                .expect("raw"),
        ),
        _ => unimplemented!(),
    };
    let data = &desc.data;
    // let data = match format {
    //     vk::Format::R8G8B8A8_SRGB => &desc.data,
    //     _ => &util::rgb_to_rgba(&desc.data),
    // };
    // // let data = &desc.data;
    // let data = util::rgb_to_rgba(&desc.data);

    let image = gpu.create_image(
        desc.extent,
        format,
        vk::ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
        vk::ImageAspectFlags::COLOR,
        &desc.name,
    )?;
    let staging = util::staging_buffer(gpu, &desc.data, &desc.name)?;
    gpu.execute(|cmd| {
        cmd.copy_buffer_to_image(&staging, &image);
    })?;
    Ok(image)
}

fn load_texture_cached(
    context: &mut LoadContext,
    index: usize,
    name: &str,
    linear: bool,
) -> Result<Texture> {
    let info = match context.document.document.textures().nth(index) {
        Some(texture) => texture,
        None => return Err(anyhow::anyhow!("Invalid texture index")),
    };

    let source = &context.images[info.source().index()];
    let extent = Extent2D {
        width: source.width,
        height: source.height,
    };

    let data = {
        let pixels = source.pixels.clone();
        match source.format {
            gltf::image::Format::R8G8B8A8 => pixels,
            gltf::image::Format::R8G8B8 => util::rgb_to_rgba(&pixels, extent),
            _ => unimplemented!(),
        }
    };
    let format = match linear {
        true => vk::Format::R8G8B8A8_UNORM,
        false => vk::Format::R8G8B8A8_SRGB,
    };

    log::debug!("Loading {name} -> texture {index} ({format:?}, linear: {linear})");
    let image = context.gpu.create_image(
        extent,
        format,
        vk::ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
        vk::ImageAspectFlags::COLOR,
        name,
    )?;
    let staging = util::staging_buffer(context.gpu, &data, name)?;

    context.gpu.execute(|cmd| {
        cmd.copy_buffer_to_image(&staging, &image);
    })?;

    Ok(image)
}

fn load_default(gpu: &Gpu, default: [u8; 4], format: vk::Format, name: &str) -> Result<Texture> {
    let extent = Extent2D {
        width: 16,
        height: 16,
    };
    let data = [default].repeat(extent.width as usize * extent.height as usize);
    let image = gpu.create_image(
        extent,
        format,
        vk::ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
        vk::ImageAspectFlags::COLOR,
        name,
    )?;
    let staging = util::staging_buffer(gpu, &data, image.label())?;
    gpu.execute(|cmd| {
        cmd.copy_buffer_to_image(&staging, &image);
    })?;
    Ok(image)
}

fn load_sampler(gpu: &Gpu, desc: &SamplerDesc) -> Result<ash::vk::Sampler> {
    gpu.create_sampler(
        desc.min_filter,
        desc.mag_filter,
        desc.mipmap_mode,
        desc.address_mode_u,
        desc.address_mode_u,
    )
}

fn load_mesh(gpu: &Gpu, document: &GltfDocument, index: usize) -> Result<Mesh> {
    let desc = &document.meshes[index];
    let name = format!("gltf-mesh{}", desc.name.as_str());
    let primitives = desc
        .primitives
        .iter()
        .map(|primitive_desc| load_primitive(gpu, primitive_desc))
        .collect::<Result<Vec<Primitive>>>()?;
    Ok(Mesh { name, primitives })
}

fn load_primitive(gpu: &Gpu, desc: &PrimitiveDesc) -> Result<Primitive> {
    let normals = calculate_normals(&desc.vertices, &desc.indices).to_vec();
    let mut vertices = Vec::with_capacity(desc.vertices.len());

    for (i,v) in desc.vertices.iter().enumerate() {
        vertices.push(Vertex {
            position: v.position,
            uv_x: v.uv_x,
            normal: v.normal,
            uv_y: v.uv_y,
            tangent: v.tangent,
            color: v.color,
            normal_derived: normals[i],
            _padding: 0.0,
        });
    }

    let index_buffer_size = size_of::<u32>() as u64 * desc.indices.len() as u64;
    let index_buffer = util::index_buffer(gpu, index_buffer_size, "index buffer")?;
    let index_staging = util::staging_buffer(gpu, &desc.indices, "index staging")?;

    let vertex_buffer_size = size_of::<Vertex>() as u64 * vertices.len() as u64;
    let vertex_buffer = util::vertex_buffer(gpu, vertex_buffer_size, "vertex buffer")?;
    let vertex_staging = util::staging_buffer(gpu, &vertices, "vertex staging")?;

    gpu.execute(|cmd| {
        cmd.copy_buffer(&vertex_staging, &vertex_buffer, vertex_buffer.size());
        cmd.copy_buffer(&index_staging, &index_buffer, index_buffer.size());
    })?;

    let model_buffer = gpu.create_shared_buffer::<GpuDrawData>(
        size_of::<GpuDrawData>() as u64,
        vk::BufferUsageFlags::UNIFORM_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
        "model buffer",
    )?;



    let transform = Mat4::from_rotation_translation(glam::Quat::IDENTITY, glam::Vec3::ZERO);

    Ok(Primitive {
        vertex_buffer,
        index_buffer,
        material_idx: desc.material,
        model_buffer,
        transform,
        vertex_count: desc.indices.len() as u32,
    })
}

fn calculate_normals(vertices: &[Vertex], indices: &[u32]) -> Vec<glam::Vec3> {
    let mut normals = vec![glam::Vec3::ZERO; vertices.len()];
    for i in (0..indices.len()).step_by(3) {
        let index = indices[i] as usize;
        let a = vertices[indices[i] as usize].position;
        let b = vertices[indices[i + 1] as usize].position;
        let c = vertices[indices[i + 2] as usize].position;
        let normal = (b - a).cross(c - a).normalize();
        normals[indices[i] as usize] += normal;
        normals[indices[i + 1] as usize] += normal;
        normals[indices[i + 2] as usize] += normal;
    }
    for normal in &mut normals {
        *normal = normal.normalize();
    }
    normals
}