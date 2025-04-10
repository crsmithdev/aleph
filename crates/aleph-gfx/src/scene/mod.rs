pub mod camera;
pub mod gltf;
pub mod material;
pub mod model;
pub mod util;

use {crate::vk::Texture, ash::vk, derive_more::Debug, glam::Mat4, std::collections::HashMap};

pub use crate::scene::{
    camera::{Camera, CameraConfig},
    gltf::GltfScene, 
    material::Material,
    model::{GpuDrawData, Mesh, Primitive, Vertex},
};

pub type Graph = petgraph::Graph<Node, ()>;

#[derive(Debug)]
pub enum NodeData {
    Mesh(usize),
    Empty,
}

#[derive(Debug)]
pub struct Node {
    pub name: String,
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

#[derive(Debug)]
pub struct Scene {
    pub root: Graph,
    #[debug("{}", materials.len())]
    pub materials: HashMap<usize, Material>,
    #[debug("{}", textures.len())]
    pub textures: Vec<Texture>,
    #[debug("{}", meshes.len())]
    pub meshes: Vec<Mesh>,
}

impl Scene {
    pub fn nodes(&self) -> Vec<&Node> {
        self.root
            .node_indices()
            .map(|index| &self.root[index])
            .collect()
    }
}

//     pub fn display(&self) -> Vec<String> {
//         let mut traversal = Bfs::new(&self.graph, NodeIndex::new(0));
//         let mut lines = vec![];
//         while let Some(index) = traversal.next(&self.graph) {
//             let node = &self.graph[index];
//             let (node_type, node_children) = match &node.data {
//                 NodeData::Mesh(mesh) => {
//                     let node_children = format!("{} primitives", mesh.primitives.len());
//                     ("Mesh", node_children)
//                 }
//                 NodeData::Empty => {
//                     let edges = self.graph.edges(index);
//                     let node_children = edges
//                         .map(|edge| format!("{}", edge.target().index()))
//                         .collect::<Vec<_>>()
//                         .join(", ");
//                     ("Empty", node_children)
//                 }
//             };
//             let line = format!(
//                 "[#{:?}] - {} ({})",
//                 index.index(),
//                 node_type,
//                 node.transform
//             );
//             lines.push(line);
//             let line = format!("  -> {}", node_children);
//             lines.push(line);
//         }

//         lines
//     }
// }
