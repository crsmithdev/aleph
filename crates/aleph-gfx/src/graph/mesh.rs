use {
    super::{util, AssetCache, GpuDrawData},
    crate::{
        graph::managers::Material,
        vk::{Buffer, Gpu, Texture},
    },
    anyhow::Result,
    ash::vk::{self, Extent2D, Handle, ImageAspectFlags, ImageUsageFlags},
    bytemuck::{Pod, Zeroable},
    derive_more::Debug,
    glam::{Mat4, Vec2, Vec3, Vec4},
    image::{DynamicImage, RgbImage, RgbaImage},
    petgraph::{graph::NodeIndex, prelude::*, visit::Dfs},
    std::mem,
};

const DEFAULT_COLOR: [f32; 4] = [0.5, 0.5, 1.0, 1.0];

#[repr(C)]
#[derive(Copy, Clone, Debug, Default, Pod, Zeroable)]
pub struct Vertex {
    pub position: Vec3,
    pub _padding1: f32,
    pub normal: Vec3,
    pub _padding2: f32,
    pub tex_coords_0: Vec2,
    pub tex_coords_1: Vec2,
    pub color: Vec4,
}

#[derive(Debug)]
pub enum Node {
    Mesh {
        local_transform: Mat4,
        mesh: Mesh,
        index: usize,
    },
    Group,
}

pub type Graph = petgraph::Graph<Node, ()>;
type GltfTextureData = gltf::image::Data;
type GltfTextureInfo<'a> = gltf::Texture<'a>;

#[derive(Debug)]
pub struct Mesh {
    pub primitives: Vec<Primitive>,
}

#[derive(Debug)]
pub struct Primitive {
    #[debug("{:x}", vertex_buffer.handle().as_raw())]
    pub vertex_buffer: Buffer<Vertex>,
    #[debug("{:x}", index_buffer.handle().as_raw())]
    pub index_buffer: Buffer<u32>,
    pub material_index: Option<usize>,
    pub material: Option<String>,
    pub model_buffer: Buffer<GpuDrawData>,
    pub model_matrix: Mat4,
    pub vertex_count: u32,
}

#[derive(Debug)]
pub struct Scene {
    pub children: Vec<Graph>,
}

struct GltfContext<'a> {
    pub gpu: &'a Gpu,
    pub materials: Vec<String>,
    pub buffers: Vec<gltf::buffer::Data>,
}

impl Mesh {}

pub fn load_gltf(path: &str, gpu: &Gpu, assets: &mut AssetCache) -> Result<Vec<Scene>> {
    let (document, buffers, images) = gltf::import(path)?;
    let materials = load_materials(gpu, &document, images, assets)?;
    let context = GltfContext {
        gpu,
        materials,
        buffers,
    };

    let scenes: Vec<Scene> = document
        .scenes()
        .map(|scene| load_scene(&context, scene))
        .collect();

    Ok(scenes)
}

pub fn load_materials(
    gpu: &Gpu,
    gltf: &gltf::Document,
    texture_data: Vec<GltfTextureData>,
    assets: &mut AssetCache,
) -> Result<Vec<String>> {
    let mut handles = vec![];
    for (i, material_data) in gltf.materials().enumerate() {
        let pbr = material_data.pbr_metallic_roughness();

        let metallic_factor = pbr.metallic_factor();
        let roughness_factor = pbr.roughness_factor();

        let base_color_info = pbr.base_color_texture().map(|t| t.texture());
        let normal_info = material_data.normal_texture().map(|t| t.texture());
        let occlusion_info = material_data.occlusion_texture().map(|t| t.texture());

        let base_color_texture = load_texture(gpu, base_color_info, &texture_data)?;
        let normal_texture = load_texture(gpu, normal_info, &texture_data)?;
        let occlusion_texture = load_texture(gpu, occlusion_info, &texture_data)?;

        let (metallic_texture, roughness_texture) = match pbr.metallic_roughness_texture() {
            Some(info) => {
                let source = texture_data[info.texture().index()].clone();
                let metallic = extract_channel(gpu, 0, &source)?;
                let roughness = extract_channel(gpu, 1, &source)?;
                (metallic, roughness)
            }
            None => {
                let factor = pbr.base_color_factor();
                let metallic = util::single_color_image(gpu, factor)?;
                let roughness = util::single_color_image(gpu, factor)?;
                (metallic, roughness)
            }
        };

        let material = Material {
            base_color_texture,
            metallic_texture,
            roughness_texture,
            metallic_factor,
            normal_texture,
            roughness_factor,
            occlusion_texture,
        };

        let key = format!("material-{}", i);
        assets.add_material(key.clone(), material);
        handles.push(key)
    }

    Ok(handles)
}

fn load_texture(
    gpu: &Gpu,
    maybe_info: Option<GltfTextureInfo>,
    texture_datas: &[GltfTextureData],
) -> Result<Texture> {
    match maybe_info {
        Some(info) => {
            let index = info.index();
            let texture = texture_datas[index].clone();
            let format = texture.format;
            let label = format!("gltf-texture-{index}");
            let extent = Extent2D {
                width: texture.width,
                height: texture.height,
            };

            create_and_upload_texture(gpu, texture.pixels.clone(), extent, format, label)
        }
        None => util::single_color_image(gpu, DEFAULT_COLOR),
    }
}

fn load_scene(context: &GltfContext, scene_data: gltf::Scene) -> Scene {
    let mut children: Vec<Graph> = vec![];
    for node in scene_data.nodes() {
        let mut node_graph = Graph::new();
        load_node(context, &node, &mut node_graph, NodeIndex::new(0));
        children.push(node_graph);
    }
    Scene { children }
}

fn extract_channel(gpu: &Gpu, index: usize, texture: &GltfTextureData) -> Result<Texture> {
    let bytes = texture.pixels.clone();
    let mut metallic_bytes = vec![];
    for i in (0..bytes.len()).step_by(4) {
        metallic_bytes.push(bytes[i]);
    }
    let extent = Extent2D {
        width: 1,
        height: 1,
    };
    create_and_upload_texture(
        gpu,
        bytes,
        extent,
        gltf::image::Format::R8G8B8A8,
        format!("material-{}-metallic", index),
    )
    // TODO
}

pub fn create_and_upload_texture(
    gpu: &Gpu,
    data: Vec<u8>,
    extent: Extent2D,
    format: gltf::image::Format,
    label: String,
) -> Result<Texture> {
    let width = extent.width;
    let height = extent.height;
    let image = match format {
        gltf::image::Format::R8G8B8A8 => {
            RgbaImage::from_raw(width, height, data).map(DynamicImage::ImageRgba8)
        }
        gltf::image::Format::R8G8B8 => {
            RgbImage::from_raw(width, height, data).map(DynamicImage::ImageRgb8)
        }

        _ => unimplemented!("Unsupported format: {:?}", format),
    };
    let image = image.ok_or_else(|| anyhow::anyhow!("Failed to create image from data"))?;

    let texture = gpu.create_image(
        extent,
        to_vk_format(format),
        ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
        ImageAspectFlags::COLOR,
        label,
    )?;
    let staging = util::staging_buffer(gpu, image.as_bytes(), "staging")?;
    gpu.execute(|cmd| {
        cmd.copy_buffer_to_image(&staging, &texture);
    })?;
    Ok(texture)
}

fn load_node(context: &GltfContext, node: &gltf::Node, graph: &mut Graph, parent_index: NodeIndex) {
    let info = {
        match node.mesh() {
            Some(mesh) => Node::Mesh {
                local_transform: determine_transform(node),
                mesh: load_mesh(context, &mesh).unwrap(),
                index: node.index(),
            },
            None => Node::Group,
        }
    };
    let index = graph.add_node(info);
    if parent_index != index {
        graph.add_edge(parent_index, index, ());
    }

    for child in node.children() {
        load_node(context, &child, graph, index);
    }
}

fn load_mesh(context: &GltfContext, mesh: &gltf::Mesh) -> Option<Mesh> {
    let mut all_primitive_info = Vec::new();
    for info in mesh.primitives() {
        let (vertices, indices) = read_buffer_data(&info, &context.buffers);
        let mut primitive = load_primitive(context, &info, &vertices, &indices).unwrap();
        let material_index = info.material().index();
        primitive.material_index = material_index;
        all_primitive_info.push(primitive);
    }
    let mesh = Mesh {
        primitives: all_primitive_info,
    };
    log::debug!("Loaded mesh: {:?}", mesh);
    Some(mesh)
}

fn determine_transform(node: &gltf::Node) -> Mat4 {
    let transform: Vec<f32> = node
        .transform()
        .matrix()
        .iter()
        .flat_map(|array| array.iter())
        .cloned()
        .collect();
    Mat4::from_cols_slice(&transform)
}

fn read_buffer_data(
    primitive: &gltf::Primitive,
    buffers: &[gltf::buffer::Data],
) -> (Vec<Vertex>, Vec<u32>) {
    let reader = primitive.reader(|buffer| Some(&buffers[buffer.index()]));

    let positions = reader.read_positions().map_or(Vec::new(), |positions| {
        positions.map(Vec3::from).collect::<Vec<_>>()
    });

    let normals = reader.read_normals().map_or(Vec::new(), |normals| {
        normals.map(Vec3::from).collect::<Vec<_>>()
    });

    let convert_coords = |coords: gltf::mesh::util::ReadTexCoords<'_>| -> Vec<Vec2> {
        coords.into_f32().map(Vec2::from).collect::<Vec<_>>()
    };
    let tex_coords_0 = reader.read_tex_coords(0).map_or(Vec::new(), convert_coords);
    let tex_coords_1 = reader.read_tex_coords(1).map_or(Vec::new(), convert_coords);

    let mut vertices = Vec::new();
    for (index, position) in positions.iter().enumerate() {
        vertices.push(Vertex {
            position: *position,
            normal: *normals.get(index).unwrap_or(&Vec3::ZERO),
            tex_coords_0: *tex_coords_0.get(index).unwrap_or(&Vec2::ZERO),
            tex_coords_1: *tex_coords_1.get(index).unwrap_or(&Vec2::ZERO),
            color: Vec4::ONE,
            _padding1: 0.,
            _padding2: 0.,
        });
    }

    let indices = reader
        .read_indices()
        .map(|read_indices| read_indices.into_u32().collect::<Vec<_>>())
        .unwrap();
    (vertices, indices)
}

fn load_primitive(
    context: &GltfContext,
    info: &gltf::mesh::Primitive,
    vertices: &[Vertex],
    indices: &[u32],
) -> Result<Primitive> {
    let material_index = info.material().index();
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
    let material = material_index.map(|index| context.materials[index].clone());

    let primitive = Primitive {
        vertex_buffer,
        index_buffer,
        material_index,
        vertex_count,
        model_buffer,
        material,
        model_matrix: Mat4::IDENTITY,
    };
    log::debug!("Loaded primitive: {:?}", primitive);
    Ok(primitive)
}

pub fn path_between_nodes(
    starting_node_index: NodeIndex,
    node_index: NodeIndex,
    graph: &Graph,
) -> Vec<NodeIndex> {
    let mut indices = Vec::new();
    let mut dfs = Dfs::new(&graph, starting_node_index);
    while let Some(current_node_index) = dfs.next(&graph) {
        let mut incoming_walker = graph
            .neighbors_directed(current_node_index, Incoming)
            .detach();
        let mut outgoing_walker = graph
            .neighbors_directed(current_node_index, Outgoing)
            .detach();

        if let Some(parent) = incoming_walker.next_node(graph) {
            while let Some(last_index) = indices.last() {
                if *last_index == parent {
                    break;
                }
                // Discard indices for transforms that are no longer needed
                indices.pop();
            }
        }

        indices.push(current_node_index);

        if node_index == current_node_index {
            break;
        }

        // If the node has no children, don't store the index
        if outgoing_walker.next(graph).is_none() {
            indices.pop();
        }
    }
    indices
}

fn to_vk_format(format: gltf::image::Format) -> vk::Format {
    match format {
        gltf::image::Format::R8 => vk::Format::R8_UNORM,
        gltf::image::Format::R8G8 => vk::Format::R8G8_UNORM,
        gltf::image::Format::R8G8B8 => vk::Format::R8G8B8_UNORM,
        gltf::image::Format::R8G8B8A8 => vk::Format::R8G8B8A8_UNORM,
        gltf::image::Format::R16 => vk::Format::R16_UNORM,
        gltf::image::Format::R16G16 => vk::Format::R16G16_UNORM,
        gltf::image::Format::R16G16B16 => vk::Format::R16G16B16_UNORM,
        gltf::image::Format::R16G16B16A16 => vk::Format::R16G16B16A16_UNORM,
        gltf::image::Format::R32G32B32FLOAT => vk::Format::R32G32B32_SFLOAT,
        gltf::image::Format::R32G32B32A32FLOAT => vk::Format::R32G32B32A32_SFLOAT,
    }
}
