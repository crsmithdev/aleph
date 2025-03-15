use {
    crate::{
        render::renderer::{Renderer, RendererConfig},
        scene::{
            gltf::{self},
            model::Scene,
            AssetCache,
        },
        vk::Gpu,
        Node,
    },
    aleph_core::{
        app::TickEvent,
        layer::{Layer, Window},
    },
    anyhow::Result,
    glam::Mat4,
    petgraph::{graph::NodeIndex, visit::Dfs},
    std::sync::{Arc, OnceLock},
};

#[derive(Default)]
pub struct GraphicsLayer {
    renderer: OnceLock<Renderer>,
    resource_manager: AssetCache,
    scene: Option<Scene>,
}

impl Layer for GraphicsLayer {
    fn init(
        &mut self,
        window: Arc<Window>,
        mut events: aleph_core::events::EventSubscriber<Self>,
    ) -> anyhow::Result<()>
    where
        Self: Sized,
    {
        let gpu = Gpu::new(Arc::clone(&window))?;
        let doc = gltf::load_gltf2("assets/gltf/suzanne/Suzanne.gltf")?;
        let scene = Scene::from_gltf(&gpu, &doc, &mut self.resource_manager)?;
        let config = RendererConfig::default();
        let renderer = Renderer::new(gpu, config)?;
        self.scene = Some(scene);

        self.renderer
            .set(renderer)
            .map_err(|_| anyhow::anyhow!("Failed to set renderer"))?;

        events.subscribe::<TickEvent>(move |layer, _event| layer.render());

        Ok(())
    }
}

impl GraphicsLayer {
    fn update_local_matrix(&mut self) {
        if let Some(scene) = &mut self.scene {
            let mut dfs = Dfs::new(&scene.root, NodeIndex::new(0));
            while let Some(node_index) = dfs.next(&scene.root) {
                let i = &mut scene.root[node_index];
                match i {
                    crate::scene::model::Node::Mesh(mesh) => {
                        let rotation = Mat4::from_rotation_y(-0.01);
                        // let rotation = rotation * Mat4::from_rotation_y(-0.01);
                        // let rotation = rotation * Mat4::from_rotation_z(-0.01);
                        mesh.local_matrix = rotation * mesh.local_matrix;
                    }
                    _ => {}
                }
            }
        }
    }
    fn update_world_matrix(&mut self, index: NodeIndex, matrix: Mat4) {
        if let Some(scene) = &mut self.scene {
            let node = &mut self.scene.as_mut().unwrap().root[index];
            let world_matrix = match node {
                Node::Mesh(mesh) => {
                    mesh.world_matrix = matrix * mesh.local_matrix;
                    mesh.world_matrix
                }
                _ => matrix,
            };
            let binding = self.scene.as_mut().unwrap();
            let children: Vec<_> = binding.root.neighbors(index).collect();
            for child in children {
                self.update_world_matrix(child, world_matrix);
            }
        }
    }

    pub fn render(&mut self) -> Result<()> {
        self.update_local_matrix();
        self.update_world_matrix(NodeIndex::new(0), Mat4::IDENTITY);
        if let Some(scene) = &mut self.scene {
            self.renderer
                .get_mut()
                .expect("Renderer not initialized")
                .execute(&scene, &self.resource_manager)?;
        }
        Ok(())
    }
}
