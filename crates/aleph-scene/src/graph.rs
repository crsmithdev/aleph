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

    pub fn rotate(mut self, delta_y_radians: f32) -> Self {
        self.local_transform = Mat4::from_rotation_y(delta_y_radians) * self.local_transform;
        self
    }

    pub fn transform(mut self, transform: Mat4) -> Self {
        self.local_transform = transform;
        self
    }
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
    /// Version counter that increments when scene content changes
    /// Used to detect when renderer resources need to be updated
    version: u64,
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
            version: 0,
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

    /// Get the current version of the scene
    pub fn version(&self) -> u64 {
        self.version
    }

    /// Increment the scene version to signal that content has changed
    fn increment_version(&mut self) {
        self.version += 1;
        log::trace!("Scene version incremented to {}", self.version);
    }
}

#[cfg(test)]
mod tests {
    use {super::*, glam::Vec3};

    #[test]
    fn test_node_creation() {
        let mesh_node = Node::mesh("test_mesh", MeshHandle::default());
        assert_eq!(mesh_node.name, "test_mesh");
        assert!(matches!(mesh_node.data, NodeData::Mesh(_)));

        let group_node = Node::group("test_group");
        assert_eq!(group_node.name, "test_group");
        assert!(matches!(group_node.data, NodeData::Group));

        let light_node = Node::light("test_light", Light::default());
        assert_eq!(light_node.name, "test_light");
        assert!(matches!(light_node.data, NodeData::Light(_)));
    }

    #[test]
    fn test_node_handles_unique() {
        let node1 = Node::group("node1");
        let node2 = Node::group("node2");
        assert_ne!(node1.handle, node2.handle);
    }

    #[test]
    fn test_scene_default() {
        let scene = Scene::default();
        assert_eq!(scene.nodes().count(), 1); // root node
        assert!(scene.node(scene.root()).is_some());
    }

    #[test]
    fn test_attach_to_root() {
        let mut scene = Scene::default();
        let node = Node::mesh("test", MeshHandle::default());
        let handle = scene.attach_to_root(node).unwrap();

        assert_eq!(scene.nodes().count(), 2);
        assert!(scene.node(handle).is_some());
        assert_eq!(scene.children(scene.root()).len(), 1);
    }

    #[test]
    fn test_attach_hierarchy() {
        let mut scene = Scene::default();
        let parent = Node::group("parent");
        let parent_handle = scene.attach_to_root(parent).unwrap();

        let child = Node::mesh("child", MeshHandle::default());
        let child_handle = scene.attach(child, parent_handle).unwrap();

        assert_eq!(scene.nodes().count(), 3);
        assert_eq!(scene.children(parent_handle).len(), 1);
        assert_eq!(scene.children(parent_handle)[0], child_handle);
    }

    #[test]
    fn test_node_transform() {
        let transform = Mat4::from_translation(Vec3::new(1.0, 2.0, 3.0));
        let node = Node::group("test").transform(transform);
        assert_eq!(node.local_transform, transform);
    }

    #[test]
    fn test_update_transforms() {
        let mut scene = Scene::default();
        let transform1 = Mat4::from_translation(Vec3::new(2.0, 2.0, 2.0));
        let transform2 = Mat4::from_translation(Vec3::new(3.0, 3.0, 3.0));

        let parent = Node::group("parent");
        let parent_handle = scene.attach_to_root(parent).unwrap();
        let child = Node::group("child").transform(transform1);
        let child_handle = scene.attach(child, parent_handle).unwrap();

        scene.update_transforms_recursive(scene.root(), transform2).unwrap();

        let parent = scene.node(parent_handle).unwrap();
        assert_eq!(parent.world_transform, transform2 * parent.local_transform);

        let child = scene.node(child_handle).unwrap();
        assert_eq!(child.world_transform, transform1 * transform2);
    }

    #[test]
    fn test_mesh_nodes() {
        let mut scene = Scene::default();
        scene.attach_to_root(Node::group("group")).unwrap();
        scene.attach_to_root(Node::mesh("mesh1", MeshHandle::default())).unwrap();
        scene.attach_to_root(Node::mesh("mesh2", MeshHandle::default())).unwrap();

        let mesh_count = scene.mesh_nodes().count();
        assert_eq!(mesh_count, 2);
    }
}
