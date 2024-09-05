use aleph_core::{logging, plugin::Plugin};
use aleph_gfx::GraphicsPlugin;
use anyhow::{Ok, Result};
use std::sync::Arc;
use winit::{
    application::ApplicationHandler,
    event_loop::EventLoop,
    window::{Window, WindowAttributes},
};
pub struct App {}

pub struct AppBuilder {}

impl AppBuilder {
    pub fn build(self) -> Result<App> {
        App::build(self)
    }
}

impl App {
    pub fn builder() -> AppBuilder {
        AppBuilder {}
    }

    pub fn build(_builder: AppBuilder) -> Result<App> {
        logging::setup_logger()?;
        Ok(App {})
    }

    pub fn run<F>(&mut self, mut _frame_fn: F) -> Result<()>
    where
        F: (FnMut(FrameContext) -> ()),
    {
        log::info!("Starting");
        let mut app = AppState::new();
        EventLoop::new()?.run_app(&mut app)?;
        Ok(())
    }
}

pub struct FrameContext {}

#[derive(Default)]
pub struct AppState {
    plugins: Vec<Box<dyn Plugin>>,
    window: Option<Arc<Window>>,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
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

impl ApplicationHandler for AppState {
    fn resumed(&mut self, event_loop: &winit::event_loop::ActiveEventLoop) {
        log::info!("Resumed");
        let window = Arc::new(
            event_loop
                .create_window(WindowAttributes::default())
                .unwrap(),
        );

        log::info!("Created window: {0:?}", window);

        self.init_plugins(window.clone());
        self.window = Some(window.clone());
        self.plugins.iter_mut().for_each(|p| p.update());
    }

    fn window_event(
        &mut self,
        _event_loop: &winit::event_loop::ActiveEventLoop,
        _window_id: winit::window::WindowId,
        _event: winit::event::WindowEvent,
    ) {
    }
}
