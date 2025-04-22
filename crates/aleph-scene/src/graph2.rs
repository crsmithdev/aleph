use {
    crate::{assets::MeshHandle, Assets, Camera, CameraConfig, Material, Mesh},
    aleph_core::layer::{Scene, SceneObject},
    aleph_vk::AllocatedTexture,
    ash::vk,
    derive_more::Debug,
    glam::{Mat4, Vec3},
    petgraph::graph::NodeIndex,
    rand,
    std::{cell::RefCell, collections::HashMap, rc::Rc},
};

pub type Graph = petgraph::Graph<Node, ()>;

#[derive(Debug)]
pub enum NodeData {
    Mesh(MeshHandle),
    Empty,
}

#[derive(Debug)]
pub struct Node {
    pub name: String,
    pub transform: Mat4,
    pub data: NodeData,
}

pub struct TextureDefaults {
    pub white_srgb: AllocatedTexture,
    pub black_srgb: AllocatedTexture,
    pub black_linear: AllocatedTexture,
    pub white_linear: AllocatedTexture,
    pub normal: AllocatedTexture,
    pub sampler: vk::Sampler,
}

pub struct Scene<'a> {
    pub graph: Rc<RefCell<Graph>>,
    pub camera: Camera,
    pub root: NodeIndex,
    pub assets: &'a Assets,
}

// impl Default for Scene {
//     fn default() -> Self {
//         let mut graph = Graph::new();
//         let root = graph.add_node(Node {
//             name: "root".to_string(),
//             transform: Mat4::IDENTITY,
//             data: NodeData::Empty,
//         });
//         let camera = Camera::new(CameraConfig::default());
//         let rng = rand::random();
//         Self {
//             camera,
//             graph: Rc::new(RefCell::new(graph)),
//             root,
//             rng,
//         }
//     }
// }

struct SceneObject {
    index: NodeIndex,
    graph: Rc<RefCell<Graph>>,
}

impl<'a> SceneObject for SceneObject {
    fn rotate(&mut self, delta: f32) {
        let graph = &mut self.graph.borrow_mut();
        let node = &mut graph[self.index];
        let transform = node.transform;

        graph[self.index].transform = Mat4::from_rotation_y(delta) * transform;
    }
}

impl<'a: 'static> Scene for Scene<'a> {
    fn translate_camera(&mut self, delta: Vec3) { self.camera.translate(delta); }

    fn rotate_camera(&mut self, delta: glam::Vec2) { self.camera.rotate(delta); }

    fn objects(&self) -> Vec<Box<dyn SceneObject>> {
        let graph_ref = self.graph.borrow_mut();
        let mut traverse = petgraph::visit::Bfs::new(&*graph_ref, self.root);
        let mut objects: Vec<Box<dyn SceneObject>> = vec![];
        while let Some(index) = traverse.next(&*graph_ref) {
            let node = &graph_ref[index];
            match node.data {
                NodeData::Mesh(_) => objects.push(Box::new(SceneObject {
                    index,
                    graph: self.graph.clone(),
                })),
                NodeData::Empty => {}
            }
        }

        objects
    }
}
