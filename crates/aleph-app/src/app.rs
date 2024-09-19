use {
    aleph_core::{logging, plugin::Plugin},
    aleph_gfx::GraphicsPlugin,
    anyhow::{Ok, Result},
    std::sync::Arc,
    winit::{
        application::ApplicationHandler,
        dpi::{PhysicalSize, Size},
        event_loop::EventLoop,
        window::Window,
    },
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
        let size = Size::Physical(PhysicalSize {
            width: 640u32,
            height: 480u32,
        });
        let window_attributes = Window::default_attributes().with_inner_size(size);
        let window = Arc::new(event_loop.create_window(window_attributes).unwrap());

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
