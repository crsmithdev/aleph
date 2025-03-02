use {
    super::{util, GpuDrawData, ResourceManager},
    crate::vk::{Buffer, Gpu},
    anyhow::Result,
    ash::vk::{self, Extent2D, Handle},
    bytemuck::{Pod, Zeroable},
    derive_more::Debug,
    glam::{Mat4, Vec2, Vec3, Vec4},
    petgraph::{
        graph::{Graph, NodeIndex},
        prelude::*,
        visit::Dfs,
    },
    std::{fmt, mem, sync::Arc},
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
    pub color: Vec4,
}

#[derive(Debug)]
pub struct Node {
    pub local_transform: Mat4,
    pub mesh: Option<Mesh>,
    pub index: usize,
}

pub type NodeGraph = Graph<Node, ()>;

pub struct Mesh {
    pub primitives: Vec<Primitive>,
}

impl fmt::Debug for Mesh {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let primitives = self
            .primitives
            .iter()
            .map(|p| format!("Primitive {{ ...{} vertices}}", p.vertex_count));
        f.debug_struct("Mesh")
            .field("primitives", &primitives.collect::<Vec<String>>())
            .finish()
    }
}

#[derive(Debug)]
pub struct Primitive {
    #[debug("{:x}", vertex_buffer.handle().as_raw())]
    pub vertex_buffer: Buffer<Vertex>,
    #[debug("{:x}", index_buffer.handle().as_raw())]
    pub index_buffer: Buffer<u32>,
    pub material_index: Option<usize>,
    pub model_buffer: Buffer<GpuDrawData>,
    pub model_matrix: Mat4,
    pub vertex_count: u32,
}

#[derive(Debug)]
pub struct Scene {
    pub nodes: Vec<NodeGraph>,
}

pub struct GltfAsset {
    pub texture_ids: Vec<String>,
    pub gltf: gltf::Document,
    pub scenes: Vec<Scene>,
}

impl Mesh {}

pub fn load_gltf(path: &str, gpu: &Gpu, resources: &mut ResourceManager) -> Result<GltfAsset> {
    let (document, buffers, images) = gltf::import(path)?;

    let texture_ids = process_textures(gpu, resources, images)?;
    let scenes = process_scenes(gpu, &document, &buffers)?;

    Ok(GltfAsset {
        texture_ids,
        gltf: document,
        scenes,
    })
}

pub fn process_scenes(
    gpu: &Gpu,
    gltf: &gltf::Document,
    buffers: &[gltf::buffer::Data],
) -> Result<Vec<Scene>> {
    let mut scenes = vec![];
    for scene in gltf.scenes() {
        let mut node_graphs: Vec<NodeGraph> = vec![];
        for node in scene.nodes() {
            let mut node_graph = NodeGraph::new();
            visit_children(gpu, &node, buffers, &mut node_graph, NodeIndex::new(0));
            node_graphs.push(node_graph);
        }
        let scene = Scene { nodes: node_graphs };
        log::debug!("Loaded scene: {:?}", scene);
        scenes.push(scene);
    }
    Ok(scenes)
}

pub fn visit_children(
    gpu: &Gpu,
    node: &gltf::Node,
    buffers: &[gltf::buffer::Data],
    node_graph: &mut NodeGraph,
    parent_index: NodeIndex,
) {
    let node_info = Node {
        local_transform: determine_transform(node),
        mesh: load_mesh(gpu, node, buffers),
        index: node.index(),
    };

    let node_index = node_graph.add_node(node_info);
    if parent_index != node_index {
        node_graph.add_edge(parent_index, node_index, ());
    }

    for child in node.children() {
        visit_children(gpu, &child, buffers, node_graph, node_index);
    }
}

fn load_mesh(gpu: &Gpu, node: &gltf::Node, buffers: &[gltf::buffer::Data]) -> Option<Mesh> {
    if let Some(mesh) = node.mesh() {
        let mut all_primitive_info = Vec::new();
        for primitive in mesh.primitives() {
            let (vertex_set, indices) = read_buffer_data(&primitive, &buffers);
            let mut primitive_info = prepare_primitive_gl(gpu, &vertex_set, &indices).unwrap();
            let material_index = primitive.material().index();
            primitive_info.material_index = material_index;
            all_primitive_info.push(primitive_info);
        }
        let mesh = Mesh {
            primitives: all_primitive_info,
        };
        log::debug!("Loaded mesh: {:?}", mesh);
        Some(mesh)
    } else {
        log::debug!("No mesh found");
        None
    }
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

pub struct VertexSet {
    pub vertices: Vec<Vertex>,
}

fn read_buffer_data(
    primitive: &gltf::Primitive,
    buffers: &[gltf::buffer::Data],
) -> (VertexSet, Vec<u32>) {
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

    // log::debug!("Read vertices [0..10]: {:?}", &vertices[0..10]);
    // log::debug!("Read indices: [0..10] {:?}", &indices[0..10]);
    (VertexSet { vertices }, indices)
}

fn prepare_primitive_gl(gpu: &Gpu, vertex_set: &VertexSet, indices: &[u32]) -> Result<Primitive> {
    let vertices: &[Vertex] = &vertex_set.vertices;
    let index_buffer_size = mem::size_of::<u32>() as u64 * indices.len() as u64;
    let index_buffer = util::index_buffer(gpu, index_buffer_size, "index buffer")?;
    let index_staging = util::staging_buffer(gpu, indices, "index staging")?;

    let vertex_buffer_size = mem::size_of::<Vertex>() as u64 * vertices.len() as u64;
    let vertex_buffer = util::vertex_buffer2(gpu, vertex_buffer_size, "vertex buffer")?;
    let vertex_staging = util::staging_buffer(gpu, vertices, "vertex staging")?;

    gpu.execute(|cmd| {
        cmd.copy_buffer(&vertex_staging, &vertex_buffer, vertex_buffer.size());
        cmd.copy_buffer(&index_staging, &index_buffer, index_buffer.size());
    })?;

    let vertex_count = indices.len() as u32;
    let model_buffer =  gpu.create_shared_buffer::<GpuDrawData>(
            mem::size_of::<GpuDrawData>() as u64,
            vk::BufferUsageFlags::UNIFORM_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
            "model buffer"
    )?;

    let primitive = Primitive {
        vertex_buffer,
        index_buffer,
        material_index: None,
        vertex_count,
        model_buffer,
        model_matrix: Mat4::IDENTITY

    };
    log::debug!("Loaded primitive: {:?}", primitive);
    Ok(primitive)
}

pub fn path_between_nodes(
    starting_node_index: NodeIndex,
    node_index: NodeIndex,
    graph: &NodeGraph,
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

pub fn calculate_global_transform(node_index: NodeIndex, graph: &NodeGraph) -> Mat4 {
    let indices = path_between_nodes(NodeIndex::new(0), node_index, graph);
    indices.iter().fold(Mat4::IDENTITY, |transform, index| {
        transform * graph[*index].local_transform /* *graph[*index].animation_transform.matrix()*/
    })
}

pub fn process_textures(
    gpu: &Gpu,
    resources: &mut ResourceManager,
    images: Vec<gltf::image::Data>,
) -> Result<Vec<String>> {
    let mut texture_ids = vec![];
    for image in images {
        let extent = Extent2D {
            width: image.width,
            height: image.height,
        };
        let format = to_vk_format(image.format);
        let name = format!("gltf-{}", texture_ids.len());
        resources.create_image(gpu, &image.pixels, extent, format, &name)?;
        texture_ids.push(name);
    }
    Ok(texture_ids)
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

pub struct MeshData {
    pub vertices: Vec<Vertex>,
    pub indices: Vec<u32>,
}

// pub fn load_mesh_data(path: &str) -> Result<Vec<MeshData>> {
//     let (document, buffers, _images) = match gltf::import(path) {
//         Ok(loaded) => loaded,
//         Err(err) => return Err(anyhow!("Error reading gltf file").context(err)),
//     };

//     // let get_buffer_data = |buffer: gltf::Buffer| buffers.get(buffer.index()).map(|x| &*x.0);
//     let mut meshes: Vec<MeshData> = vec![];

//     for mesh in document.meshes() {
//         for primitive in mesh.primitives().take(1) {
//             let reader = primitive.reader(|buffer| Some(&buffers[buffer.index()]));
//             // let mut indices = vec![];
//             // let mut positions = vec![];
//             // let mut normals = vec![];
//             // let mut tex_coords = vec![];
//             // let mut joints = vec![];
//             // let mut weights = vec![];

//             // if let Some(iter) = reader.read_indices() {
//             //     for i in iter.into_u32() {
//             //         indices.push(i)
//             //     }
//             // }

//             // if let Some(iter) = reader.read_positions() {
//             //     for p in iter {
//             //         positions.push(p)
//             //     }
//             // }

//             // if let Some(iter) = reader.read_normals() {
//             //     for n in iter {
//             //         normals.push(n)
//             //     }
//             // }

//             // if let Some(iter) = reader.read_tex_coords(0) {
//             //     for tc in iter.into_f32() {
//             //         tex_coords.push(tc)
//             //     }
//             // }

//             let positions = reader
//                 .read_positions()
//                 .ok_or(anyhow::anyhow!("Error reading mesh positions"))?;
//             let normals = reader
//                 .read_normals()
//                 .ok_or(anyhow::anyhow!("Error reading mesh normals"))?;
//             let tex_coords = reader
//                 .read_tex_coords(0)
//                 .ok_or(anyhow::anyhow!("Error reading mesh tex_coords"))?
//                 .into_f32();

//             let vertices: Vec<Vertex> = izip!(positions, normals, tex_coords)
//                 .map(|(position, normal, tex_coord)| Vertex {
//                     position: position.into(),
//                     normal: normal.into(),
//                     // uv_x: 1.,
//                     // uv_y: 1.,
//                     uv_x: tex_coord[0],
//                     uv_y: tex_coord[1],
//                     color: vec4(1., 1., 1., 1.),
//                 })
//                 .collect();
//             let indices = reader
//                 .read_indices()
//                 .ok_or(anyhow::anyhow!("Error reading mesh indices"))?
//                 .into_u32()
//                 .collect::<Vec<u32>>();

//             let data = MeshData { vertices, indices };
//             meshes.push(data);
//         }
//     }
//     Ok(meshes)
// }
