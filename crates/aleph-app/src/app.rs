use {
    aleph_core::{
        constants::{DEFAULT_WINDOW_SIZE, STEP_TIME_US, UPDATE_TIME_US},
        logging,
    },
    aleph_gfx::{renderer::Renderer, ui::UiRenderer},
    aleph_hal::vk::Context,
    anyhow::{anyhow, Result},
    core::panic,
    std::{
        cell::OnceCell,
        fmt,
        sync::Arc,
        time::{Duration, Instant},
    },
    winit::{
        application::ApplicationHandler,
        event::WindowEvent,
        event_loop::{ActiveEventLoop, ControlFlow, EventLoop},
        window::{Window, WindowId},
    },
};
#[derive(Debug, Default)]
pub struct App {}

impl App {
    pub fn run(&mut self) {
        println!("RUST_LOG: {:?}", std::env::var("RUST_LOG"));
        logging::setup_logger().expect("Failed to setup logger");

        let event_loop = EventLoop::new().expect("Failed to create event loop");
        let state = AppState::default();
        let mut handler = AppHandler { state };
        match event_loop.run_app(&mut handler).map_err(|err| anyhow!(err)) {
            Ok(_) => {}
            Err(err) => log::error!("Error: {err}"),
        }
    }
}

#[allow(dead_code)]
pub struct AppState {
    renderer: OnceCell<Renderer>,
    ui: OnceCell<UiRenderer>,
    window: OnceCell<Arc<Window>>,
    last_update: Instant,
    last_render: Instant,
    total_steps: u64,
    step_accumulator: i64,
    exiting: bool,
    initialized: bool,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            window: OnceCell::new(),
            renderer: OnceCell::new(),
            ui: OnceCell::new(),
            step_accumulator: 0,
            last_update: Instant::now(),
            last_render: Instant::now(),
            total_steps: 0,
            exiting: false,
            initialized: false,
        }
    }
}

impl fmt::Debug for AppState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppState")
            .field("renderer", &self.renderer)
            .field("window", &self.window)
            .field("last_update", &self.last_update)
            .field("last_step", &self.total_steps)
            .field("step_accumulator", &self.step_accumulator)
            .field("exiting", &self.exiting)
            .field("initialized", &self.initialized)
            .finish()
    }
}

impl AppState {
    pub fn init(&mut self, event_loop: &ActiveEventLoop) -> Result<()> {
        // setup_panic!(Metadata::new("Aleph App", "0.1.0")
        //     .authors("Aleph Developers")
        //     .homepage("https://aleph.rs")
        //     .support("https://aleph.rs/support"));
        let attributes = Window::default_attributes().with_inner_size(DEFAULT_WINDOW_SIZE);
        let window = Arc::new(event_loop.create_window(attributes)?);
        log::info!("Created window: {window:?}");

        let backend = Context::new(window.clone())?;
        log::info!("Created render backend: {:?}", &backend);

        let renderer = Renderer::new(backend)?;
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

        // renderer.render(j).expect("test");
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

            // let _ = self.renderer.take();
            // let _ = self.window.take();
            std::process::exit(0)
        }
    }
}

struct AppHandler {
    state: AppState,
}

impl ApplicationHandler for AppHandler {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        log::info!("Resumed");

        if let Err(err) = self.state.init(event_loop) {
            log::error!("Failed to initialize app state: {err}");
            event_loop.exit();
            panic!("Failed to initialize app state");
        }
    }

    fn new_events(&mut self, _event_loop: &ActiveEventLoop, _cause: winit::event::StartCause) {
        if self.state.exiting || !self.state.initialized {
            return;
        }

        let renderer = self
            .state
            .renderer
            .get_mut()
            .expect("Failed to acquire renderer");
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
        _event_loop: &ActiveEventLoop,
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
                match self.state.render() {
                    Ok(_) => {}
                    Err(err) => {
                        log::error!("Error rendering: {err}");
                    }
                };
            }
            WindowEvent::CloseRequested => {
                log::info!("Close requested");
                self.state.exit();
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
