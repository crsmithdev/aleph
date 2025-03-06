use {
    crate::{
        render::renderer::{Renderer, RendererConfig},
        scene::{
            gltf::{self, Scene},
            AssetCache,
        },
        vk::Gpu,
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
    renderer: OnceLock<Renderer>,
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
        let config = RendererConfig::default();
        let mut scenes = gltf::load_gltf(
            "assets/gltf/suzanne/Suzanne.gltf",
            &gpu,
            &mut self.resource_manager,
        )?;
        let scene = scenes
            .pop()
            .ok_or_else(|| anyhow::anyhow!("No scene found"))?;
        let graph = Renderer::new(gpu, config)?;

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
