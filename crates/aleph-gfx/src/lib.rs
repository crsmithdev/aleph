pub mod mesh;
pub mod renderer;
pub mod ui;

use {
    crate::renderer::Renderer,
    aleph_core::{
        app::TickEvent,
        layer::{Layer, Window},
    },
    aleph_hal::{self, Gpu},
    std::sync::{Arc, OnceLock},
};

pub struct RenderContex<'a> {
    pub gfx: &'a Gpu,
}

#[derive(Default, Debug)]
pub struct GraphicsLayer {
    renderer: OnceLock<Renderer>,
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
        let renderer = Renderer::new(Arc::clone(&window))?;
        log::info!("Created renderer: {:?}", &renderer);

        self.renderer
            .set(renderer)
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
            .render()
    }
}
