use {
    crate::renderer::{Renderer, RendererConfig},
    aleph_core::{
        events::GuiEvent,
        layer::{Layer, Scene, UpdateContext, Window},
    },
    aleph_scene::{gltf, SceneGraph},
    aleph_vk::Gpu,
    anyhow::Result,
    std::sync::{Arc, OnceLock},
};

#[derive(Default)]
pub struct RenderLayer {
    config: RendererConfig,
    renderer: OnceLock<Renderer>,
}

impl RenderLayer {
    pub fn with_config(config: RendererConfig) -> Self {
        Self {
            config: config,
            renderer: OnceLock::new(),
            // scene: SceneGraph::default(),
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
        let renderer = Renderer::new(gpu, self.config.clone())?;
        self.renderer
            .set(renderer)
            .map_err(|_| anyhow::anyhow!("Failed to set renderer"))?;
        events.subscribe::<GuiEvent>(move |layer, event| {
            layer
                .renderer
                .get_mut()
                .expect("renderer")
                .gui
                .on_window_event(&event.event);
            Ok(())
        });

        Ok(())
    }

    fn update(&mut self, ctx: &mut UpdateContext) -> anyhow::Result<()> {
        let renderer = self.renderer.get().unwrap();

        if let Some(path) = self.config.initial_scene.as_ref() {
            let scene: SceneGraph = gltf::load(&renderer.gpu, path)?;
            let boxed: Box<dyn Scene> = Box::new(scene);
            ctx.scene = boxed;
            self.config.initial_scene = None;
        }

        let scene = ctx.scene.downcast_ref::<SceneGraph>().unwrap();
        self.render(scene)?;
        Ok(())
    }
}

impl RenderLayer {
    pub fn render(&mut self, scene: &SceneGraph) -> Result<()> {
        self.renderer
            .get_mut()
            .expect("Renderer not initialized")
            .execute(scene)
    }
}
