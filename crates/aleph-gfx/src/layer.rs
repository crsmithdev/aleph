use {
    crate::{
        graph::{
            config::RenderConfig,
            mesh::{self, Scene},
            AssetCache,
        },
        vk::Gpu,
        RenderGraph,
    },
    aleph_core::{
        app::TickEvent,
        layer::{Layer, Window},
    },
    anyhow::Result,
    std::sync::{Arc, OnceLock},
};

#[derive(Default)]
pub struct GraphicsLayer {
    renderer: OnceLock<RenderGraph>,
    resource_manager: AssetCache,
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
        let config = RenderConfig::default();
        let mut scenes = mesh::load_gltf(
            "assets/gltf/suzanne/Suzanne.gltf",
            &gpu,
            &mut self.resource_manager,
        )?;
        let scene = scenes
            .pop()
            .ok_or_else(|| anyhow::anyhow!("No scene found"))?;
        let graph = RenderGraph::new(gpu, config)?;

        self.renderer
            .set(graph)
            .map_err(|_| anyhow::anyhow!("Failed to set renderer"))?;

        events.subscribe::<TickEvent>(move |layer, _event| layer.render(&scene));

        Ok(())
    }
}

impl GraphicsLayer {
    pub fn render(&mut self, scene: &Scene) -> Result<()> {
        self.renderer
            .get_mut()
            .expect("Renderer not initialized")
            .execute(scene, &self.resource_manager)
    }
}
