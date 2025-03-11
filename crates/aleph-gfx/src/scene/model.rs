use {
    super::{
        gltf::{GltfDocument, MeshDesc, PrimitiveDesc, SamplerDesc, TextureDesc},
        material::AssetHandle,
        util, AssetCache, Material,
    }, crate::vk::{self, Buffer, Gpu, Texture}, anyhow::Result, ash::vk::{Extent2D, Filter, Handle, ImageUsageFlags, SamplerMipmapMode}, bytemuck::{Pod, Zeroable}, derive_more::Debug, glam::{Mat3, Mat4, Vec2, Vec3, Vec4}, image::{DynamicImage, RgbaImage}, std::{any::type_name_of_val, collections::HashMap, mem}
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

struct GraphInitContext<'a> {
    pub gpu: &'a Gpu,
    pub document: &'a GltfDocument,
    pub assets: &'a HashMap<usize, AssetHandle>,
}

pub type Graph = petgraph::Graph<Node, ()>;

#[derive(Debug)]
pub struct Mesh {
    pub primitives: Vec<Primitive>,
    pub local_transform: Mat4,
}

impl Mesh {}

#[derive(Debug)]
pub struct Primitive {
    #[debug("{:x}", vertex_buffer.handle().as_raw())]
    pub vertex_buffer: Buffer<Vertex>,
    #[debug("{:x}", index_buffer.handle().as_raw())]
    pub index_buffer: Buffer<u32>,
    pub material: Option<AssetHandle>,
    pub model_buffer: Buffer<GpuDrawData>,
    pub model_matrix: Mat4,
    pub vertex_count: u32,
}

impl Primitive {
    fn from_desc(context: &GraphInitContext, desc: &PrimitiveDesc) -> Result<Self> {
        let label = format!("primitive-{}-{}", desc.mesh_idx, desc.index);

        // let vertex_buffer = util::vertex_buffer(
        //     context.gpu,
        //     desc.vertices.len() as u64,
        //     format!("{}-vertex", label),
        // )?;

        // let index_buffer = util::index_buffer(
        //     context.gpu,
        //     desc.indices.len() as u64,
        //     format!("{}-index", label),
        // )?;
        // let model_buffer = context.gpu.create_shared_buffer::<GpuDrawData>(
        //     mem::size_of::<GpuDrawData>() as u64,
        //     vk::BufferUsageFlags::UNIFORM_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
        //     format!("{}-model", label),
        // )?;
        let model_matrix = Mat4::IDENTITY;
        let vertex_count = desc.indices.len() as u32;
        let material = match desc.material_idx {
            Some(material_idx) => context.assets.get(&material_idx).map(|h| *h),
            None => None,
        };
        let indices = &desc.indices;
        let vertices = &desc.vertices;
        let gpu = context.gpu;

        let index_buffer_size = mem::size_of::<u32>() as u64 * indices.len() as u64;
        let index_buffer = util::index_buffer(gpu, index_buffer_size, "index buffer")?;
        let index_staging = util::staging_buffer(gpu, indices, "index staging")?;
    
        let vertex_buffer_size = mem::size_of::<Vertex>() as u64 * vertices.len() as u64;
        let vertex_buffer = util::vertex_buffer(gpu, vertex_buffer_size, "vertex buffer")?;
        let vertex_staging = util::staging_buffer(gpu, vertices, "vertex staging")?;
    
        gpu.execute(|cmd| {
            cmd.copy_buffer(&vertex_staging, &vertex_buffer, vertex_buffer.size());
            cmd.copy_buffer(&index_staging, &index_buffer, index_buffer.size());
        })?;
    
        let vertex_count = indices.len() as u32;
        let model_buffer = gpu.create_shared_buffer::<GpuDrawData>(
            mem::size_of::<GpuDrawData>() as u64,
            vk::BufferUsageFlags::UNIFORM_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
            "model buffer",
        )?;

        Ok(Self {
            vertex_buffer,
            index_buffer,
            material,
            model_buffer,
            model_matrix,
            vertex_count,
        })
    }
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
    pub normal: Mat3,
    pub padding1: Vec3,
    pub position: Vec3,
    pub padding2: f32,
}

#[derive(Debug)]
pub enum Node {
    Mesh(Mesh),
    Group,
}

pub struct Scene {
    pub graph: Graph,
}

impl Scene {
    pub fn from_gltf(gpu: &Gpu, document: &GltfDocument, assets: &mut AssetCache) -> Result<Scene> {
        let material_handles = load_materials(gpu, document, assets)?;
        let graph = load_graph(gpu, document, &material_handles)?;
        Ok(Scene { graph })
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
    let context = GraphInitContext {
        gpu,
        document,
        assets,
    };

    for (i, desc) in scene.nodes.iter().enumerate() {
        let node = if let Some(index) = desc.mesh {
            let mesh = load_mesh(&context, index)?;
            Node::Mesh(mesh)
        } else {
            Node::Group
        };

        let index = graph.add_node(node);
        node_map.insert(i, index);
    }

    for (i, desc) in scene.nodes.iter().enumerate() {
        let node_idx = node_map[&i];
        for child in &desc.child_idxs {
            let child_idx = node_map[&child];
            graph.add_edge(node_idx, child_idx, ());
        }
    }

    Ok(graph)
}

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
        let base_color_texture = match desc.base_texture_idx {
            Some(idx) => load_texture(gpu, textures, idx)?,
            None => util::single_color_image(gpu, [0.8, 0.8, 0.8, 1.0], e, "base-color-default")?,
        };
        let normal_texture = match desc.normal_texture_idx {
            Some(idx) => load_texture(gpu, textures, idx)?,
            None => util::single_color_image(gpu, [0.5, 0.5, 1.0, 1.0],e , "normal-default")?,
        };
        println!("occlusion");
        let occlusion_texture = match desc.occlusion_texture_idx {
            Some(idx) => load_texture(gpu, textures, idx)?,
            None => util::single_color_image(gpu, [0.5, 0.5, 0.5, 0.5],e , "occlusion-default")?,
        };
        println!("metallic");
        let metallic_roughness_texture = match desc.metallic_roughness_texture_idx {
            Some(idx) => load_texture(gpu, textures, idx)?,
            None => util::single_color_image(gpu, [0.0, 0.0, 0.0, 1.0],e, "metallic-default")?,
        };
        println!("roughness");
        let base_color_sampler = match desc.base_sampler_idx {
            Some(idx) => load_sampler(gpu, samplers, idx)?,
            None => {
                gpu.create_sampler(Filter::NEAREST, Filter::NEAREST, SamplerMipmapMode::NEAREST)?
            }
        };
        let normal_sampler = match desc.base_sampler_idx {
            Some(idx) => load_sampler(gpu, samplers, idx)?,
            None => {
                gpu.create_sampler(Filter::NEAREST, Filter::NEAREST, SamplerMipmapMode::NEAREST)?
            }
        };
        let occlusion_sampler = match desc.base_sampler_idx {
            Some(idx) => load_sampler(gpu, samplers, idx)?,
            None => {
                gpu.create_sampler(Filter::NEAREST, Filter::NEAREST, SamplerMipmapMode::NEAREST)?
            }
        };
        let metallic_roughness_sampler = match desc.base_sampler_idx {
            Some(idx) => load_sampler(gpu, samplers, idx)?,
            None => {
                gpu.create_sampler(Filter::NEAREST, Filter::NEAREST, SamplerMipmapMode::NEAREST)?
            }
        };
        let material = Material {
            base_color_texture,
            base_color_sampler,
            normal_texture,
            normal_sampler,
            metallic_roughness_texture,
            metallic_factor: desc.metallic_factor,
            roughness_factor: desc.roughness_factor,
            occlusion_texture,
            occlusion_sampler,
            metallic_roughness_sampler,
        };
        let handle = assets.add_material(material);
        handles.insert(i, handle);
    }
    Ok(handles)
}

fn load_texture(gpu: &Gpu, textures: &[TextureDesc], index: usize) -> Result<Texture> {
    let texture_desc = &textures[index];
    let width = texture_desc.extent.width;
    let height = texture_desc.extent.height;
    let data = texture_desc.data.clone(); 
    // let image1 = RgbaImage::from_raw(width, height, data).unwrap();
    // let image =  RgbaImage::from_raw(width, height, data).map(DynamicImage::ImageRgba).unwrap();
    // let data = image.as_bytes();
    let image = gpu.create_image(
        texture_desc.extent,
        texture_desc.format,
        vk::ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
        vk::ImageAspectFlags::COLOR,
        &texture_desc.name,
    )?;
    let staging = util::staging_buffer(
        gpu,
        &texture_desc.data,
        format!("{}-staging", &texture_desc.name),
    )?;
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

fn load_mesh(context: &GraphInitContext, index: usize) -> Result<Mesh> {
    let desc = &context.document.meshes[index];
    let primitives = desc
        .primitives
        .iter()
        .map(|primitive_desc| Primitive::from_desc(context, primitive_desc))
        .collect::<Result<Vec<Primitive>>>()?;
    Ok(Mesh {
        primitives,
        local_transform: Mat4::IDENTITY,
    })
}
