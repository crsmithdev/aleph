use std::sync::Arc;

use anyhow::Result;
use winit::window::Window;

pub trait Plugin {
    fn init(&self, window: Arc<Window>) -> Result<()>;
    fn update(&self);
    fn cleanup(&self);
}
