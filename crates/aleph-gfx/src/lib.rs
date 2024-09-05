use aleph_core::plugin::Plugin;
use aleph_hal::vk::RenderBackend;
use anyhow::Result;
use renderer::Renderer;
use std::{cell::OnceCell, sync::Arc};
use winit::window::Window;
pub mod renderer;

pub struct GraphicsPlugin {
    renderer: OnceCell<Renderer>,
}

impl GraphicsPlugin {
    pub fn new() -> Self {
        Self {
            renderer: OnceCell::new(),
        }
    }
}

impl Plugin for GraphicsPlugin {
    fn init(&self, window: Arc<Window>) -> Result<()> {
        let backend = RenderBackend::new(window.clone())?;
        let renderer = Renderer::new(backend)?;
        let _ = self.renderer.set(renderer);
        Ok(())
    }

    fn update(&mut self) {
        let renderer = self.renderer.get_mut().unwrap();
        renderer.update().unwrap();
    }

    fn cleanup(&self) {
        todo!()
    }
}
