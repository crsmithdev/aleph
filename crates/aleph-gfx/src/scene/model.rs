use {
    super::{
        gltf::{GltfDocument, PrimitiveDesc, SamplerDesc, TextureDesc},
        material::AssetHandle,
        util, AssetCache, Material,
    },
    crate::vk::{
        self, Buffer, Extent2D, Filter, Gpu, Handle, ImageUsageFlags, SamplerMipmapMode, Texture,
    },
    anyhow::Result,
    bytemuck::{Pod, Zeroable},
    derive_more::Debug,
    glam::{Mat3, Mat4, Vec2, Vec3, Vec4},
    std::{collections::HashMap, mem::size_of},
    tracing::instrument,
};

#[repr(C)]
#[derive(Copy, Clone, Debug, Default, Pod, Zeroable)]
pub struct Vertex {
    pub position: Vec3,
    pub _padding1: f32,
    pub normal: Vec3,
    pub _padding2: f32,
    pub tex_coords_0: Vec2,
    pub tex_coords_1: Vec2,
    pub tangent: Vec4,
}



#[derive(Debug)]
pub struct Mesh {
    pub primitives: Vec<Primitive>,
    pub local_matrix: Mat4,
    pub world_matrix: Mat4,
}

#[derive(Debug)]
pub struct Primitive {
    #[debug("{:x}", vertex_buffer.handle().as_raw())]
    pub vertex_buffer: Buffer<Vertex>,
    #[debug("{:x}", index_buffer.handle().as_raw())]
    pub index_buffer: Buffer<u32>,
    #[debug("{:x}", model_buffer.handle().as_raw())]
    pub model_buffer: Buffer<GpuDrawData>,
    pub model_matrix: Mat4,
    pub material: Option<AssetHandle>,
    pub vertex_count: u32,
}


#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuSceneData {
    pub view: Mat4,
    pub projection: Mat4,
    pub view_projection: Mat4,
    pub lights: [Vec3; 4],
    pub _padding1: Vec4,
    pub camera_position: Vec3,
    pub _padding2: f32,
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuMaterialData {
    pub albedo: Vec4,
    pub _padding: f32,
    pub metallic: f32,
    pub roughness: f32,
    pub ao: f32,
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuDrawData {
    pub model: Mat4,
    pub model_view: Mat4,
    pub model_view_projection: Mat4,
    pub world_matrix: Mat4,
    pub normal: Mat3,
    pub padding1: Vec3,
    pub position: Vec3,
    pub padding2: f32,
}
pub type Graph = petgraph::Graph<Node, ()>;

#[derive(Debug)]
pub enum Node {
    Mesh(Mesh),
    Group,
}

pub struct Scene {
    pub root: Graph,
    materials: Vec<Material>,
}

impl Scene {
    pub fn from_gltf(gpu: &Gpu, document: &GltfDocument, assets: &mut AssetCache) -> Result<Scene> {
        let material_handles = load_materials(gpu, document, assets)?;
        let graph = load_graph(gpu, document, &material_handles)?;
        Ok(Scene { root: graph, materials: vec![] })
    }
}

fn load_graph(
    gpu: &Gpu,
    document: &GltfDocument,
    assets: &HashMap<usize, AssetHandle>,
) -> Result<Graph> {
    let mut graph = Graph::new();
    let mut node_map = HashMap::new();
    let scene = &document.scenes[0];

    for (i, desc) in scene.nodes.iter().enumerate() {
        let node = if let Some(index) = desc.mesh {
            let mesh = load_mesh(gpu, document, assets, index)?;
            Node::Mesh(mesh)
        } else {
            Node::Group
        };

        let index = graph.add_node(node);
        node_map.insert(i, index);
    }

    for (i, desc) in scene.nodes.iter().enumerate() {
        let node_idx = node_map[&i];
        for child in &desc.children {
            let child_idx = node_map[&child];
            graph.add_edge(node_idx, child_idx, ());
        }
    }

    Ok(graph)
}

#[instrument(skip_all)]
fn load_materials(
    gpu: &Gpu,
    document: &GltfDocument,
    assets: &mut AssetCache,
) -> Result<HashMap<usize, AssetHandle>> {
    let textures = &document.textures;
    let samplers = &document.samplers;
    let mut handles = HashMap::new();
    for (i, desc) in document.materials.iter().enumerate() {
        let e = Extent2D {
            width: 1024,
            height: 1024,
        };
        let albedo_map = match desc.albedo_texture {
            Some(idx) => load_texture(gpu, &textures[idx])?,
            None => util::single_color_image(gpu, [0.8, 0.8, 0.8, 1.0], e, "albedo-default")?,
        };
        let normal_map = match desc.normal_texture {
            Some(idx) => load_texture(gpu, &textures[idx])?,
            None => util::single_color_image(gpu, [0.5, 0.5, 1.0, 1.0], e, "normal-default")?,
        };
        let occlusion_map = match desc.occlusion_texture {
            Some(idx) => load_texture(gpu, &textures[idx])?,
            None => util::single_color_image(gpu, [0.5, 0.5, 0.5, 0.5], e, "occlusion-default")?,
        };
        let (metallic_map, roughness_map) = match desc.metallic_roughnness_texture {
            Some(idx) => {
                let source = &textures[idx].data;
                let metallic_data = extract_color_channel(&source, 2);
                let metallic_desc = TextureDesc {
                    index: idx,
                    data: metallic_data,
                    extent: e,
                    format: vk::Format::R8_UNORM,
                    name: "metallic".to_string(),
                };
                let metallic = load_texture(gpu, &metallic_desc)?;

                let roughness_data = extract_color_channel(&source, 1);
                let roughness_desc = TextureDesc {
                    index: idx,
                    data: roughness_data,
                    extent: e,
                    format: vk::Format::R8_UNORM,
                    name: "roughness".to_string(),
                };
                let roughness = load_texture(gpu, &roughness_desc)?;

                (metallic, roughness)
            }
            None => {
                // TODO factors
                let extent = Extent2D {
                    width: 1024,
                    height: 1024,
                };
                let metallic =
                    util::single_color_image(gpu, [0.5, 0.5, 0.5, 0.5], extent, "metallic")?;
                let roughness =
                    util::single_color_image(gpu, [0.5, 0.5, 0.5, 0.5], extent, "roughness")?;
                (metallic, roughness)
            }
        };
        let albedo_sampler = match desc.albedo_sampler {
            Some(idx) => load_sampler(gpu, samplers, idx)?,
            None => {
                gpu.create_sampler(Filter::NEAREST, Filter::NEAREST, SamplerMipmapMode::NEAREST)?
            }
        };
        let normal_sampler = match desc.albedo_sampler {
            Some(idx) => load_sampler(gpu, samplers, idx)?,
            None => {
                gpu.create_sampler(Filter::NEAREST, Filter::NEAREST, SamplerMipmapMode::NEAREST)?
            }
        };
        let occlusion_sampler = match desc.albedo_sampler {
            Some(idx) => load_sampler(gpu, samplers, idx)?,
            None => {
                gpu.create_sampler(Filter::NEAREST, Filter::NEAREST, SamplerMipmapMode::NEAREST)?
            }
        };
        let metallic_sampler = match desc.albedo_sampler {
            Some(idx) => load_sampler(gpu, samplers, idx)?,
            None => {
                gpu.create_sampler(Filter::NEAREST, Filter::NEAREST, SamplerMipmapMode::NEAREST)?
            }
        };
        let roughness_sampler = metallic_sampler.clone();

        let material = Material {
            albedo_map,
            albedo_sampler,
            normal_map,
            normal_sampler,
            metallic_map,
            roughness_map,
            metallic_factor: desc.metallic_factor,
            roughness_factor: desc.roughness_factor,
            occlusion_map,
            occlusion_sampler,
            metallic_sampler,
            roughness_sampler,
        };
        let handle = assets.add_material(material);
        handles.insert(i, handle);
    }
    Ok(handles)
}

fn extract_color_channel(bytes: &[u8], channel: usize) -> Vec<u8> {
    let mut extracted = vec![];

    for i in (0..bytes.len()).step_by(4) {
        extracted.push(bytes[i + channel]);
    }

    extracted
}

fn load_texture(gpu: &Gpu, desc: &TextureDesc) -> Result<Texture> {
    let image = gpu.create_image(
        desc.extent,
        desc.format,
        vk::ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
        vk::ImageAspectFlags::COLOR,
        &desc.name,
    )?;
    let staging = util::staging_buffer(gpu, &desc.data, format!("{}-staging", &desc.name))?;
    gpu.execute(|cmd| {
        cmd.copy_buffer_to_image(&staging, &image);
    })?;
    Ok(image)
}

fn load_sampler(gpu: &Gpu, samplers: &[SamplerDesc], index: usize) -> Result<ash::vk::Sampler> {
    let sampler_desc = &samplers[index];
    let sampler = gpu.create_sampler(
        sampler_desc.min_filter,
        sampler_desc.mag_filter,
        sampler_desc.mipmap_mode,
    )?;
    Ok(sampler)
}

fn load_mesh(
    gpu: &Gpu,
    document: &GltfDocument,
    asset_handles: &HashMap<usize, AssetHandle>,
    index: usize,
) -> Result<Mesh> {
    let desc = &document.meshes[index];
    let primitives = desc
        .primitives
        .iter()
        .map(|primitive_desc| load_primitive(gpu, asset_handles, primitive_desc))
        .collect::<Result<Vec<Primitive>>>()?;
    Ok(Mesh {
        primitives,
        local_matrix: Mat4::IDENTITY,
        world_matrix: Mat4::IDENTITY,
    })
}

fn load_primitive(
    gpu: &Gpu,
    asset_handles: &HashMap<usize, AssetHandle>,
    desc: &PrimitiveDesc,
) -> Result<Primitive> {
    let model_matrix = Mat4::IDENTITY;

    let material = match desc.material {
        Some(material_idx) => asset_handles.get(&material_idx).map(|h| *h),
        None => None,
    };
    let indices = &desc.indices;
    let vertices = &desc.vertices;

    let index_buffer_size = size_of::<u32>() as u64 * indices.len() as u64;
    let index_buffer = util::index_buffer(gpu, index_buffer_size, "index buffer")?;
    let index_staging = util::staging_buffer(gpu, indices, "index staging")?;

    let vertex_buffer_size = size_of::<Vertex>() as u64 * vertices.len() as u64;
    let vertex_buffer = util::vertex_buffer(gpu, vertex_buffer_size, "vertex buffer")?;
    let vertex_staging = util::staging_buffer(gpu, vertices, "vertex staging")?;

    gpu.execute(|cmd| {
        cmd.copy_buffer(&vertex_staging, &vertex_buffer, vertex_buffer.size());
        cmd.copy_buffer(&index_staging, &index_buffer, index_buffer.size());
    })?;

    let vertex_count = indices.len() as u32;
    let model_buffer = gpu.create_shared_buffer::<GpuDrawData>(
        size_of::<GpuDrawData>() as u64,
        vk::BufferUsageFlags::UNIFORM_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
        "model buffer",
    )?;

    Ok(Primitive {
        vertex_buffer,
        index_buffer,
        material,
        model_buffer,
        model_matrix,
        vertex_count,
    })
}
