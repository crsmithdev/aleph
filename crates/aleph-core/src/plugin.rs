use {anyhow::Result, std::sync::Arc, winit::window::Window};

pub trait Plugin {
    fn init(&self, window: Arc<Window>) -> Result<()>;
    fn update(&mut self);
    fn cleanup(&self);
}
