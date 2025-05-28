use {
    crate::{model::Light, Camera, CameraConfig, MeshHandle},
    anyhow::{anyhow, Result},
    derive_more::Debug,
    glam::Mat4,
    petgraph::graph::NodeIndex,
    std::{
        collections::HashMap,
        hash::Hash,
        sync::atomic::{AtomicU64, Ordering},
    },
};

#[derive(Debug, Clone)]
pub enum NodeData {
    Mesh(MeshHandle),
    Light(Light),
    Camera(CameraConfig),
    Group,
}

#[derive(Debug, Clone)]
pub struct Node {
    pub handle: NodeHandle,
    pub name: String,
    pub data: NodeData,
    pub world_transform: Mat4,
    pub local_transform: Mat4,
}

impl Node {
    fn new(name: &str, data: NodeData) -> Self {
        Self {
            handle: NodeHandle::next(),
            name: name.to_string(),
            world_transform: Mat4::IDENTITY,
            local_transform: Mat4::IDENTITY,
            data,
        }
    }

    pub fn group(name: &str) -> Self { Self::new(name, NodeData::Group) }

    pub fn mesh(name: &str, mesh: MeshHandle) -> Self { Self::new(name, NodeData::Mesh(mesh)) }

    pub fn light(name: &str, light: Light) -> Self { Self::new(name, NodeData::Light(light)) }

    pub fn camera(name: &str, config: CameraConfig) -> Self {
        Self::new(name, NodeData::Camera(config))
    }

    pub fn rotate(&mut self, delta_y_radians: f32) {
        self.local_transform = Mat4::from_rotation_y(delta_y_radians) * self.local_transform;
    }

    pub fn transform(&mut self, transform: Mat4) { self.local_transform = transform; }
}

#[derive(Default, Clone, Copy, PartialEq, Eq, Hash)]
pub struct NodeHandle(u64);

impl Debug for NodeHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Node({})", self.0)
    }
}

impl NodeHandle {
    pub fn next() -> Self {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        Self(COUNTER.fetch_add(1, Ordering::Relaxed))
    }
}

pub type Graph = petgraph::Graph<Node, ()>;

#[derive(Debug)]
pub struct Scene {
    pub camera: Camera,
    graph: Graph,
    root: NodeHandle,
    indices: HashMap<NodeHandle, NodeIndex>,
}

impl Default for Scene {
    fn default() -> Self {
        let mut graph = Graph::new();
        let root_node = Node::group("root");
        let root_handle = root_node.handle;
        let root_index = graph.add_node(root_node);

        let mut indices = HashMap::new();
        indices.insert(root_handle, root_index);

        Self {
            camera: Camera::new(CameraConfig::default()),
            graph,
            root: root_handle,
            indices,
        }
    }
}

impl Scene {
    fn handle_to_index(&self, handle: NodeHandle) -> Result<NodeIndex> {
        self.indices
            .get(&handle)
            .copied()
            .ok_or_else(|| anyhow!("Node {handle:?} not found in index map"))
    }

    pub fn root(&self) -> NodeHandle { self.root }

    pub fn attach_to_root(&mut self, node: Node) -> Result<NodeHandle> {
        self.attach(node, self.root)
    }

    pub fn attach(&mut self, node: Node, parent_handle: NodeHandle) -> Result<NodeHandle> {
        let parent_index = self.handle_to_index(parent_handle)?;
        let node_handle = node.handle;

        let parent_transform = self
            .graph
            .node_weight(parent_index)
            .ok_or_else(|| {
                anyhow!("Parent node {parent_handle:?} (index {parent_index:?}) not found in graph")
            })?
            .world_transform;

        let mut new_node = node;
        new_node.world_transform = parent_transform * new_node.local_transform;

        log::debug!("Attached {new_node:?} to parent {parent_handle:?}");

        let node_index = self.graph.add_node(new_node);
        self.indices.insert(node_handle, node_index);
        self.graph.add_edge(parent_index, node_index, ());

        Ok(node_handle)
    }

    pub fn children(&self, node_handle: NodeHandle) -> Vec<NodeHandle> {
        let index = self.indices.get(&node_handle).unwrap();
        let children = self.graph.neighbors(*index).collect::<Vec<_>>();
        children.iter().map(|child| self.graph.node_weight(*child).unwrap().handle).collect()
    }

    pub fn update_transform(&mut self, handle: NodeHandle, transform: Mat4) -> Result<Mat4> {
        let node_index = self.handle_to_index(handle)?;
        let node = self
            .graph
            .node_weight_mut(node_index)
            .ok_or_else(|| anyhow!("Node {handle:?} not found"))?;

        node.world_transform = transform * node.local_transform;
        Ok(node.world_transform)
    }

    pub fn update_transforms_recursive(
        &mut self,
        handle: NodeHandle,
        transform: Mat4,
    ) -> Result<()> {
        let transform = self.update_transform(handle, transform)?;
        for child in self.children(handle) {
            self.update_transforms_recursive(child, transform)?;
        }

        Ok(())
    }

    pub fn nodes(&self) -> impl Iterator<Item = &Node> { self.graph.node_weights() }
    pub fn nodes_mut(&mut self) -> impl Iterator<Item = &mut Node> { self.graph.node_weights_mut() }

    pub fn node_mut(&mut self, handle: NodeHandle) -> Option<&mut Node> {
        self.indices.get(&handle).and_then(|idx| self.graph.node_weight_mut(*idx))
    }
    pub fn node(&self, handle: NodeHandle) -> Option<&Node> {
        self.indices.get(&handle).and_then(|idx| self.graph.node_weight(*idx))
    }

    pub fn mesh_nodes(&self) -> impl Iterator<Item = &Node> {
        self.graph.node_weights().filter(|node| matches!(node.data, NodeData::Mesh(_)))
    }

    pub fn clear(&mut self) { *self = Self::default(); }
}
