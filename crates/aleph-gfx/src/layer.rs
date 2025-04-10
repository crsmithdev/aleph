use {
    crate::render::renderer::{Renderer, RendererConfig},
    aleph_core::{
        app::TickEvent,
        input::InputState,
        layer::{Layer, Window},
    },
    aleph_scene::{gltf, Scene},
    aleph_vk::Gpu,
    anyhow::Result,
    std::sync::{Arc, OnceLock},
};

#[derive(Default)]
pub struct RenderLayer {
    config: RendererConfig,
    renderer: OnceLock<Renderer>,
    scene: Scene,
}

impl RenderLayer {
    pub fn with_config(config: RendererConfig) -> Self {
        Self {
            config: config,
            renderer: OnceLock::new(),
            scene: Scene::default(),
        }
    }
}

impl Layer for RenderLayer {
    fn init(
        &mut self,
        window: Arc<Window>,
        mut events: aleph_core::events::EventSubscriber<Self>,
    ) -> anyhow::Result<()>
    where
        Self: Sized,
    {
        let gpu = Gpu::new(Arc::clone(&window))?;
        if let Some(path) = self.config.initial_scene.as_ref() {
            self.scene = gltf::load(&gpu, path)?
        }
        let renderer = Renderer::new(gpu, self.config.clone())?;
        self.renderer
            .set(renderer)
            .map_err(|_| anyhow::anyhow!("Failed to set renderer"))?;
        events.subscribe::<TickEvent>(move |layer, event| layer.render(&event.input));

        Ok(())
    }
}

impl RenderLayer {
    pub fn render(&mut self, input: &InputState) -> Result<()> {
        self.renderer
            .get_mut()
            .expect("Renderer not initialized")
            .execute(&self.scene, input)
    }
}
