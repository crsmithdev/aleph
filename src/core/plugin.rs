use anyhow::Result;
use std::sync::Arc;
use winit::window::Window;

pub trait Plugin {
    fn init(&self, window: Arc<Window>) -> Result<()>;
    fn update(&self);
    fn cleanup(&self);
}
