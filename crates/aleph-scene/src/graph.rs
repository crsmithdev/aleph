use {
    crate::{model::Light, Camera, CameraConfig, MeshHandle},
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

pub struct Node {
    pub handle: NodeHandle,
    pub name: String,
    pub transform: Mat4,
    pub local_transform: Mat4,
    pub data: NodeType,
}

impl Node {
    pub fn new(name: &str, data: NodeType) -> Self {
        Self {
            handle: NodeHandle::next(),
            name: name.to_string(),
            transform: Mat4::IDENTITY,
            local_transform: Mat4::IDENTITY,
            data,
        }
    }

    pub fn rotate(&mut self, delta: f32) {
        self.transform = Mat4::from_rotation_y(delta) * self.transform;
    }
}

impl Debug for Node {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let transform = format!(
            "[{:?}, {:?}, {:?}]",
            self.transform.row(0).to_array(),
            self.transform.row(1).to_array(),
            self.transform.row(2).to_array()
        );
        f.debug_struct("Node")
            .field("name", &self.name)
            .field("handle", &self.handle)
            .field("data", &self.data)
            .field("transform", &transform)
            .finish()
    }
}

#[derive(Default)]
pub enum NodeType {
    #[default]
    Group,
    Mesh(MeshHandle),
    Camera(Camera),
    Light(Light),
}

impl Debug for NodeType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NodeType::Group => f.write_str("Group()"),
            NodeType::Camera(camera) => f.write_str(&format!("Camera({:?})", camera)),
            NodeType::Light(light) => f.write_str(&format!("Light({:?})", light)),
            NodeType::Mesh(handle) => f.write_str(&format!("Mesh({:?})", handle)),
        }
    }
}

#[derive(Default, Clone, Copy, PartialEq, Eq, Hash)]
pub struct NodeHandle(u64);

impl Debug for NodeHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "NodeHandle({})", self.0)
    }
}

impl NodeHandle {
    pub fn next() -> Self {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        Self(COUNTER.fetch_add(1, Ordering::Relaxed))
    }
}

pub type Graph = petgraph::Graph<NodeHandle, ()>;

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
        let root = NodeHandle::next();
        let index = graph.add_node(root);
        nodes.insert(
            root,
            Node {
                handle: root,
                name: "root".to_string(),
                transform: Mat4::IDENTITY,
                local_transform: Mat4::IDENTITY,
                data: NodeType::Group,
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
    fn index_for(&self, handle: NodeHandle) -> Result<NodeIndex> {
        self.indices
            .get(&handle)
            .map(|i| *i)
            .ok_or_else(|| anyhow::anyhow!("Index for handle {handle:?} not found"))
    }

    pub fn attach_root(&mut self, node: Node) -> Result<()> { self.attach(node, self.root) }

    pub fn attach(&mut self, node: Node, parent: NodeHandle) -> Result<()> {
        let index = self.graph.add_node(node.handle);
        let parent_index = self.index_for(parent)?;

        log::debug!(
            "Attached as child: {:?} -> {:?} (index: {})",
            parent,
            node.handle,
            index.index(),
        );

        self.indices.insert(node.handle, index);
        self.nodes.insert(node.handle, node);
        self.graph.add_edge(parent_index, index, ());
        Ok(())
    }

    pub fn children(&self, node: NodeHandle) -> Vec<NodeHandle> {
        let index = self.indices.get(&node).unwrap();
        let children = self.graph.neighbors(*index).collect::<Vec<_>>();
        children.iter().map(|child| *self.graph.node_weight(*child).unwrap()).collect()
    }

    pub fn parent(&self, node: NodeHandle) -> Option<NodeHandle> {
        let index = self.indices.get(&node).unwrap();
        let parent = self.graph.neighbors_directed(*index, petgraph::Direction::Incoming).next();
        parent.map(|parent| *self.graph.node_weight(parent).unwrap())
    }

    pub fn detach(&mut self, node: NodeHandle) -> Option<Node> {
        let node = self.nodes.remove(&node);
        node
    }

    pub fn mesh_nodes(&self) -> impl Iterator<Item = &Node> {
        self.nodes.values().filter(|node| matches!(node.data, NodeType::Mesh(_)))
    }

    pub fn nodes(&self) -> impl Iterator<Item = &Node> { self.nodes.values() }

    pub fn nodes_mut(&mut self) -> impl Iterator<Item = &mut Node> { self.nodes.values_mut() }

    pub fn node_mut(&mut self, handle: NodeHandle) -> Option<&mut Node> {
        self.nodes.get_mut(&handle)
    }

    pub fn node(&self, handle: NodeHandle) -> Option<&Node> { self.nodes.get(&handle) }

    pub fn clear(&mut self) { *self = Self::default(); }
}
