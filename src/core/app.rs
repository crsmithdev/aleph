use crate::{core::plugin::Plugin, gfx::GraphicsPlugin, logging};
use anyhow::{Ok, Result};
use std::sync::Arc;
use winit::{
    application::ApplicationHandler,
    event_loop::EventLoop,
    window::{Window, WindowAttributes},
};
pub struct AppContainer {}

pub struct AppBuilder {}

impl AppBuilder {
    pub fn build(self) -> Result<AppContainer> {
        AppContainer::build(self)
    }
}

impl AppContainer {
    pub fn builder() -> AppBuilder {
        AppBuilder {}
    }

    pub fn build(_builder: AppBuilder) -> Result<AppContainer> {
        logging::setup_logger()?;
        Ok(AppContainer {})
    }

    pub fn run<F>(&mut self, mut _frame_fn: F) -> Result<()>
    where
        F: (FnMut(FrameContext) -> ()),
    {
        log::info!("run");
        let mut app = App::new();
        EventLoop::new()?.run_app(&mut app)?;
        Ok(())
    }
}

pub struct FrameContext {}

#[derive(Default)]
pub struct App {
    plugins: Vec<Box<dyn Plugin>>,
    window: Option<Arc<Window>>,
}

impl App {
    pub fn new() -> Self {
        App {
            plugins: vec![Box::new(GraphicsPlugin::new())],
            window: None,
        }
    }

    pub fn init_plugins(&self, window: Arc<Window>) {
        self.plugins
            .iter()
            .for_each(|p| p.init(window.clone()).unwrap());
    }
}
impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &winit::event_loop::ActiveEventLoop) {
        log::info!("Resumed");
        let window = Arc::new(
            event_loop
                .create_window(WindowAttributes::default())
                .unwrap(),
        );

        self.init_plugins(window.clone());
        self.window = Some(window.clone());
        log::info!("window: {0:?}", window);
    }

    fn window_event(
        &mut self,
        _event_loop: &winit::event_loop::ActiveEventLoop,
        _window_id: winit::window::WindowId,
        _event: winit::event::WindowEvent,
    ) {
    }
}
