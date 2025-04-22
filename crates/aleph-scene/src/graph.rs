use {
    crate::{assets::MeshHandle, Camera, CameraConfig},
    anyhow::Result,
    derive_more::Debug,
    glam::Mat4,
    petgraph::graph::NodeIndex,
    std::{
        collections::HashMap,
        hash::Hash,
        sync::atomic::{AtomicU64, Ordering},
    },
};

static NODE_HANDLE_INDEX: AtomicU64 = AtomicU64::new(0);

#[derive(Default, Debug)]
pub struct Node {
    pub name: String,
    pub transform: Mat4,
    pub data: NodeData,
}

impl Node {
    pub fn rotate(&mut self, delta: f32) {
        self.transform = Mat4::from_rotation_y(delta) * self.transform;
    }
}

#[derive(Default, Debug)]
pub enum NodeData {
    #[default]
    Empty,
    Mesh(MeshHandle),
}

#[derive(Debug)]
pub struct NodeDesc {
    pub name: String,
    pub index: usize,
    pub parent: Option<usize>,
    pub transform: Mat4,
    pub mesh: Option<MeshHandle>,
    pub children: Vec<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct NodeHandle {
    index: u64,
}

impl NodeHandle {
    pub fn new() -> Self {
        let index = NODE_HANDLE_INDEX.fetch_add(1, Ordering::Relaxed);
        Self { index }
    }
}

pub type Graph = petgraph::Graph<NodeHandle, ()>;

#[derive(Debug, Default)]
pub struct SceneDesc {
    pub name: String,
    pub nodes: Vec<NodeDesc>,
}

#[derive(Debug)]
pub struct Scene {
    nodes: HashMap<NodeHandle, Node>,
    indices: HashMap<NodeHandle, NodeIndex>,
    graph: petgraph::Graph<NodeHandle, ()>,
    pub camera: Camera,
    pub root: NodeHandle,
}

impl Default for Scene {
    fn default() -> Self {
        let mut graph = Graph::new();
        let mut indices = HashMap::new();
        let mut nodes = HashMap::new();
        let root = NodeHandle::new();
        log::debug!("root handle: {root:?}");
        let index = graph.add_node(root);
        nodes.insert(
            root,
            Node {
                name: "root".to_string(),
                transform: Mat4::IDENTITY,
                data: NodeData::Empty,
            },
        );
        indices.insert(root, index);

        let camera = Camera::new(CameraConfig::default());
        Self {
            camera,
            graph,
            nodes,
            root,
            indices,
        }
    }
}

impl Scene {
    fn get_index_for_handle(&self, handle: NodeHandle) -> Result<NodeIndex> {
        self.indices
            .get(&handle)
            .map(|i| *i)
            .ok_or_else(|| anyhow::anyhow!("Index for handle {handle:?} not found"))
    }
    pub fn attach(&mut self, node: Node, parent_handle: Option<NodeHandle>) -> Result<NodeHandle> {
        let node_handle = NodeHandle::new();
        let node_index = self.graph.add_node(node_handle);
        self.indices.insert(node_handle, node_index);
        self.nodes.insert(node_handle, node);

        let parent_handle = parent_handle.unwrap_or(self.root);
        let parent_index = self.get_index_for_handle(parent_handle)?;

        self.graph.add_edge(parent_index, node_index, ());

        log::debug!(
            "Attached node: {:?} (parent: {:?})",
            node_handle,
            parent_handle
        );
        Ok(node_handle)
    }

    pub fn children(&self, node: NodeHandle) -> Vec<NodeHandle> {
        let index = self.indices.get(&node).unwrap();
        let children = self.graph.neighbors(*index).collect::<Vec<_>>();
        children
            .iter()
            .map(|child| *self.graph.node_weight(*child).unwrap())
            .collect()
    }

    pub fn parent(&self, node: NodeHandle) -> Option<NodeHandle> {
        let index = self.indices.get(&node).unwrap();
        let parent = self
            .graph
            .neighbors_directed(*index, petgraph::Direction::Incoming)
            .next();
        parent.map(|parent| *self.graph.node_weight(parent).unwrap())
    }

    pub fn detach(&mut self, node: NodeHandle) -> Option<Node> {
        let node = self.nodes.remove(&node);
        node
    }

    pub fn mesh_nodes(&self) -> impl Iterator<Item = &Node> {
        self.nodes
            .values()
            .filter(|node| matches!(node.data, NodeData::Mesh(_)))
    }

    pub fn nodes(&self) -> impl Iterator<Item = &Node> { self.nodes.values() }

    pub fn nodes_mut(&mut self) -> impl Iterator<Item = &mut Node> { self.nodes.values_mut() }

    pub fn node_mut(&mut self, handle: NodeHandle) -> Option<&mut Node> {
        self.nodes.get_mut(&handle)
    }

    pub fn node(&self, handle: NodeHandle) -> Option<&Node> { self.nodes.get(&handle) }

    pub fn clear(&mut self) {
        self.graph = petgraph::Graph::new();
        self.nodes.clear();
        self.indices.clear();

        let root_handle = self.root; //NodeHandle(HANDLE_INDEX.fetch_add(1, Ordering::Relaxed));
        let root_index = self.graph.add_node(root_handle);
        self.nodes.insert(
            root_handle,
            Node {
                name: "root".to_string(),
                transform: Mat4::IDENTITY,
                data: NodeData::Empty,
            },
        );
        self.indices.insert(root_handle, root_index);
        self.camera = Camera::new(CameraConfig::default());

        log::debug!(
            "Cleared scene -> root: {:?}, nodes: {}, indices: {}, graph: {}",
            self.root,
            self.nodes.len(),
            self.indices.len(),
            self.graph.node_count(),
        );
    }

    pub fn load(&mut self, gltf: SceneDesc) -> Result<()> {
        self.clear();

        let mut index_map = HashMap::new();
        let mut remaining = gltf.nodes;

        while remaining.len() > 0 {
            log::debug!("Loading scene nodes, {} remaining...", remaining.len());
            let mut next_remaining = vec![];
            for desc in remaining {
                let parent_handle = desc.parent.map(|i| index_map.get(&i).map(|h| *h)).flatten();

                if desc.parent.is_some() && parent_handle.is_none() {
                    log::debug!(
                        "Deferring glTF node {} ({}): parent not yet loaded",
                        desc.index,
                        desc.name
                    );
                    next_remaining.push(desc);
                    continue;
                }

                let node = Node {
                    name: desc.name.clone(),
                    transform: desc.transform,
                    data: match desc.mesh {
                        Some(mesh) => NodeData::Mesh(mesh),
                        None => NodeData::Empty,
                    },
                };

                log::debug!(
                    "Loading glTF node {} ({}), parent glTF index: {:?} -> handle {:?}",
                    desc.index,
                    desc.name,
                    desc.parent,
                    parent_handle,
                );

                let handle = self.attach(node, parent_handle)?;
                index_map.insert(desc.index, handle);
            }
            remaining = next_remaining;
        }

        //             // log::debug!(
        //             //     "parent index: {}, orig: {}, child index: {}, orig: {}",
        //             //     index.index(),
        //             //     node.index,
        //             //     child_index.index(),
        //             //     child,
        //             // );
        //             // log::debug!(
        //             //     "Loaded node: {} (transform: {:?}, mesh: {:?})",
        //             //     name,
        //             //     transform.to_cols_array_2d(),
        //             //     mesh_index,
        //             // );

        Ok(())
    }
}
