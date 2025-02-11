use {
    aleph_core::{
        app::TickEvent,
        layer::{Layer, Window},
    },
    crate::vk::Gpu,
    crate::RenderGraph,
    std::sync::{Arc, OnceLock},
};

#[derive(Default)]
pub struct GraphicsLayer {
    renderer: OnceLock<RenderGraph>,
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
        let graph = RenderGraph::new(gpu)?;

        // let renderer = Renderer::new(Arc::clone(&window))?;
        // log::info!("Created renderer: {:?}", &renderer);

        self.renderer
            .set(graph)
            .map_err(|_| anyhow::anyhow!("Failed to set renderer"))?;

        events.subscribe::<TickEvent>(|layer, _event| layer.render());

        Ok(())
    }
}

impl GraphicsLayer {
    pub fn render(&mut self) -> anyhow::Result<()> {
        self.renderer
            .get_mut()
            .expect("Renderer not initialized")
            .execute()
    }
}