use {
    crate::{DEFAULT_APP_NAME, DEFAULT_WINDOW_SIZE, STEP_TIME_US, UPDATE_TIME_US},
    aleph_core::logging,
    aleph_gfx::GraphicsLayer,
    aleph_hal::vk::Context,
    anyhow::{anyhow, bail, Result},
    derive_more::Debug,
    human_panic::setup_panic,
    std::{
        sync::{Arc, OnceLock},
        time::{Duration, Instant},
    },
    winit::{
        application::ApplicationHandler,
        event::WindowEvent,
        event_loop::{ActiveEventLoop, ControlFlow, EventLoop},
        window::{Window, WindowId},
    },
};

#[derive(Debug)]

pub struct AppConfig {
    pub name: String,
}

impl AppConfig {
    pub fn name(mut self, value: &str) -> Self {
        self.name = value.to_string();
        self
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            name: DEFAULT_APP_NAME.to_string(),
        }
    }
}
pub struct App {
    handler: AppHandler,
}

impl App {
    pub fn new(config: AppConfig) -> Self {
        let state = AppState::new(config);
        let handler = AppHandler { state };

        App { handler }
    }

    pub fn run(&mut self) -> Result<()> {
        logging::setup_logger()?;
        setup_panic!();

        let event_loop = EventLoop::new().expect("Failed to create event loop");
        event_loop
            .run_app(&mut self.handler)
            .map_err(|err| anyhow!(err))
    }
}

// #[allow(dead_code)]
#[derive(Debug)]
pub struct AppState {
    renderer: OnceLock<GraphicsLayer>,
    window: OnceLock<Arc<Window>>,
    last_update: Instant,
    total_steps: u64,
    step_accumulator: i64,
    exiting: bool,
    initialized: bool,
    config: AppConfig,
}

impl AppState {
    fn new(config: AppConfig) -> Self {
        AppState {
            window: OnceLock::new(),
            renderer: OnceLock::new(),
            step_accumulator: 0,
            last_update: Instant::now(),
            total_steps: 0,
            exiting: false,
            initialized: false,
            config,
        }
    }
}

impl AppState {
    pub fn init(&mut self, event_loop: &ActiveEventLoop) -> Result<()> {
        if self.initialized {
            bail!("AppState already initialized")
        }
        let attributes = Window::default_attributes()
            .with_inner_size(DEFAULT_WINDOW_SIZE)
            .with_title(self.config.name.clone());
        let window = Arc::new(event_loop.create_window(attributes)?);
        log::info!("Created window: {window:?}");

        let context = Context::new(window.clone())?;
        log::info!("Created render backend: {:?}", &context);

        let renderer = GraphicsLayer::new(context)?;
        log::info!("Created renderer: {:?}", &renderer);

        self.window
            .set(window)
            .map_err(|_| anyhow!("Window already initialized"))?;
        self.renderer
            .set(renderer)
            .map_err(|_| anyhow!("Renderer already initialized"))?;
        self.initialized = true;
        Ok(())
    }

    fn update(&mut self, now: Instant) -> Result<()> {
        if self.exiting || !self.initialized {
            return Ok(());
        }

        let elapsed = now.duration_since(self.last_update);
        self.step_elapsed(elapsed);
        self.last_update = now;

        Ok(())
    }

    fn render(&mut self) -> Result<()> {
        if self.exiting || !self.initialized {
            return Ok(());
        }
        let renderer = self
            .renderer
            .get_mut()
            .expect("Renderer dropped or not initialized");

        renderer.render()?;

        Ok(())
    }

    fn step_elapsed(&mut self, elapsed: Duration) {
        let elapsed_us = elapsed.as_micros().min(UPDATE_TIME_US);

        self.step_accumulator = match self.total_steps {
            0 => STEP_TIME_US as i64,
            _ => self.step_accumulator + elapsed_us as i64,
        };

        while self.step_accumulator >= STEP_TIME_US as i64 {
            self.step_accumulator -= STEP_TIME_US as i64;
            self.step();
            self.total_steps += 1;
        }
    }

    fn step(&mut self) {
        // ...
    }

    fn exit(&mut self) {
        if !self.exiting {
            self.exiting = true;
            log::info!("Exiting");

            let _ = self.renderer.take();
            let _ = self.window.take();
            std::process::exit(0)
        }
    }
}

// #[derive(Default)]
// struct AppHandler2 {
//     state: OnceCell<AppState2>,
// }

// #[derive(Debug)]
// struct AppState2 {
//     renderer: Renderer,
//     last_update: Instant,
//     total_steps: u64,
//     step_accumulator: i64,
//     exiting: bool,
//     initialized: bool,
// }

struct AppHandler {
    state: AppState,
}

// impl AppHandler {
//     fn init(&mut self, event_loop: &ActiveEventLoop) -> Result<()> {
//         Ok(())
//     }

//     fn update_ui_delta(&mut self) {
//         // let renderer = self.state.renderer.get_mut().unwrap();
//         // renderer.ui_mut().update_delta_time();
//     }
// }

impl ApplicationHandler for AppHandler {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        log::info!("Resumed");
        if let Err(err) = self.state.init(event_loop) {
            log::error!("Failed to initialize app state: {err}");
            event_loop.exit();
        }
    }

    fn new_events(&mut self, _event_loop: &ActiveEventLoop, _cause: winit::event::StartCause) {
        if self.state.exiting || !self.state.initialized {
            return;
        }

        let renderer = self.state.renderer.get_mut().unwrap();
        let ui = renderer.ui_mut();
        ui.update_delta_time();
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if self.state.exiting || !self.state.initialized {
            return;
        }

        self.state
            .update(Instant::now())
            .expect("Error updating app state");
        match self.state.render() {
            Ok(_) => {}
            Err(err) => {
                log::error!("Error rendering: {err}");
                panic!();
            }
        }

        event_loop.set_control_flow(ControlFlow::WaitUntil(
            Instant::now() + Duration::from_millis(1),
        ));
    }

    fn exiting(&mut self, _event_loop: &ActiveEventLoop) {
        self.state.exit();
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        window_id: WindowId,
        event: WindowEvent,
    ) {
        if self.state.exiting || !self.state.initialized {
            return;
        }

        match event {
            WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
                log::info!("Window scale factor changed: {scale_factor}");
            }
            WindowEvent::RedrawRequested => {
                log::info!("Window redraw requested");
                //self.state.render().expect("Rendering error");
            }
            WindowEvent::CloseRequested => {
                log::info!("Close requested");
                event_loop.exit();
                std::process::exit(0);
            }
            WindowEvent::KeyboardInput { ref event, .. } => {
                log::info!("Keyboard input: {event:?}");
            }
            WindowEvent::MouseInput { button, state, .. } => {
                log::info!("Mouse input: {button:?}, {state:?}");
            }
            WindowEvent::Resized(size) => {
                log::info!("Window resized: {size:?}");
            }
            _ => {}
        }

        let event2: winit::event::Event<()> = winit::event::Event::WindowEvent { window_id, event };
        self.state
            .renderer
            .get_mut()
            .unwrap()
            .ui_mut()
            .handle_event(event2);
    }
}
