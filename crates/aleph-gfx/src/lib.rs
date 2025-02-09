pub mod camera;
pub mod graph;
pub mod mesh;
pub mod mesh_pipeline;
pub mod renderer;
pub mod ui;
pub mod util;

use {
    aleph_core::{
        app::TickEvent,
        layer::{Layer, Window},
    },
    aleph_hal::{self, Gpu},
    std::sync::{Arc, OnceLock},
};
pub use {
    camera::Camera,
    graph::{RenderContext, RenderGraph},
};

pub struct RenderContex<'a> {
    pub gfx: &'a Gpu,
}

#[derive(Default)]
pub struct GraphicsLayer {
    renderer: OnceLock<RenderGraph>,
    gpu: OnceLock<Gpu>,
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
