use {
    aleph_core::{
        constants::{DEFAULT_WINDOW_SIZE, MAX_FRAMES, STEP_TIME_US, UPDATE_TIME_US},
        logging,
    },
    aleph_gfx::renderer::Renderer,
    aleph_hal::vk::render_backend::RenderBackend,
    anyhow::{anyhow, Result},
    human_panic::setup_panic,
    std::{
        cell::OnceCell,
        fmt,
        sync::Arc,
        time::{Duration, Instant},
    },
    winit::{
        application::ApplicationHandler,
        dpi::Size,
        event::WindowEvent,
        event_loop::{ActiveEventLoop, ControlFlow, EventLoop},
        window::{Window, WindowId},
    },
};

pub struct App {}

pub struct AppBuilder {}

impl AppBuilder {
    pub fn build(self) -> Result<App> {
        App::build(self)
    }
}

impl Default for App {
    fn default() -> Self {
        App {}
    }
}
impl App {
    pub fn builder() -> AppBuilder {
        AppBuilder {}
    }

    pub fn build(_builder: AppBuilder) -> Result<App> {
        logging::setup_logger()?;
        setup_panic!();

        Ok(App::default())
    }

    pub fn run<F>(&mut self, mut _frame_fn: F) -> Result<()>
    where
        F: (FnMut(FrameContext) -> ()),
    {
        let state = AppState::default();
        EventLoop::new()?
            .run_app(&mut AppHandler { state })
            .map_err(|err| anyhow!(err))
    }
}

pub struct FrameContext {}

pub struct AppState {
    renderer: OnceCell<Renderer>,
    window: OnceCell<Arc<Window>>,
    last_update: Instant,
    last_step: u64,
    last_frame: u64,
    last_heartbeat: u64,
    step_accumulator: i64,
    is_exiting: bool,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            window: OnceCell::new(),
            renderer: OnceCell::new(),
            step_accumulator: 0,
            last_update: Instant::now(),
            last_heartbeat: 0,
            last_step: 0,
            last_frame: 0,
            is_exiting: false,
        }
    }
}

impl fmt::Debug for AppState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppState")
            .field("renderer", &self.renderer)
            .field("window", &self.window)
            .field("last_update", &self.last_update)
            .field("last_step", &self.last_step)
            .field("step_accumulator", &self.step_accumulator)
            .field("last_heartbeat", &self.last_heartbeat)
            .field("last_frame", &self.last_frame)
            .field("exiting", &self.is_exiting)
            .finish()
    }
}

impl AppState {
    pub fn init(&mut self, event_loop: &ActiveEventLoop) -> Result<()> {
        let attributes = Window::default_attributes().with_inner_size(DEFAULT_WINDOW_SIZE);
        let window = Arc::new(event_loop.create_window(attributes)?);
        log::info!("Created window: {window:?}");

        let backend = RenderBackend::new(&window)?;
        log::info!("Created render backend: {:?}", &backend);
        let renderer = Renderer::new(backend)?;
        log::info!("Created renderer: {:?}", &renderer);

        self.window
            .set(window)
            .map_err(|_| anyhow!("Window already initialized"))?;
        self.renderer
            .set(renderer)
            .map_err(|_| anyhow!("Renderer already initialized"))?;

        log::info!("Initialized");
        Ok(())
    }

    fn update(&mut self, now: Instant) {
        if self.is_exiting {
            return;
        }

        let elapsed = now.duration_since(self.last_update);
        self.step_elapsed(elapsed);
        self.last_update = now;
    }

    fn resize(&mut self, size: Size) {
        if self.is_exiting {
            return;
        }

        if let Some(renderer) = self.renderer.get_mut() {
            let scale_factor = match self.window.get() {
                Some(window) => window.scale_factor(),
                None => 1.0,
            };
            let size = size.to_physical(scale_factor);

            if let Err(err) = renderer.resize(size.width, size.height) {
                log::error!("Failed to resize renderer: {err}");
                self.exit();
            }
        }
    }

    fn render(&mut self) {
        if self.is_exiting {
            return;
        }

        match self.renderer.get_mut() {
            Some(renderer) => match renderer.render() {
                Ok(_) => {
                    self.last_frame += 1;
                    if MAX_FRAMES > 0 && self.last_frame >= MAX_FRAMES {
                        log::info!("Exiting after max frames of {}", MAX_FRAMES);
                        self.exit();
                    }
                }
                Err(err) => {
                    log::error!("Unhandled error while rendering: {err}");
                    self.exit();
                }
            },
            None => {
                log::error!("Cannot render, Renderer not initialized or already destroyed");
                self.exit();
            }
        }
    }

    fn step_elapsed(&mut self, elapsed: Duration) {
        let elapsed_us = elapsed.as_micros().min(UPDATE_TIME_US);

        self.step_accumulator = match self.last_step {
            0 => STEP_TIME_US as i64,
            _ => self.step_accumulator + elapsed_us as i64,
        };

        while self.step_accumulator >= STEP_TIME_US as i64 {
            self.step_accumulator -= STEP_TIME_US as i64;
            self.step();
            self.last_step += 1;
        }
    }

    fn step(&mut self) {
        // ...
    }

    fn exit(&mut self) {
        if !self.is_exiting {
            self.is_exiting = true;
            log::info!("Exiting");

            let _ = self.renderer.take();
            let _ = self.window.take();
            std::process::exit(0)
        }
    }
}

struct AppHandler {
    state: AppState,
}

impl<'a> ApplicationHandler for AppHandler {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        log::info!("Resumed");
        if let Err(err) = self.state.init(event_loop) {
            log::error!("Failed to initialize app state: {err}");
            event_loop.exit();
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if !self.state.is_exiting {
            self.state.update(Instant::now());
            event_loop.set_control_flow(ControlFlow::WaitUntil(
                Instant::now() + Duration::from_millis(1),
            ));
            self.state.render();
        }
    }

    fn exiting(&mut self, _event_loop: &ActiveEventLoop) {
        self.state.exit();
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        event: WindowEvent,
    ) {
        if let Some(_) = self.state.window.get() {
            match event {
                WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
                    log::info!("Window scale factor changed: {scale_factor}");
                }
                WindowEvent::RedrawRequested => {
                    log::info!("Window redraw requested");
                    self.state.render();
                }
                WindowEvent::CloseRequested => {
                    log::info!("Close requested");
                    event_loop.exit();
                    std::process::exit(0);
                }
                WindowEvent::KeyboardInput { event, .. } => {
                    log::info!("Keyboard input: {event:?}");
                }
                WindowEvent::MouseInput { button, state, .. } => {
                    log::info!("Mouse input: {button:?}, {state:?}");
                }
                WindowEvent::Resized(size) => {
                    log::info!("Window resized: {size:?}");
                    self.state.resize(size.into());
                }
                _ => {}
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_state_default() {
        let app_state = AppState::default();
        assert!(app_state.window.get().is_none());
        assert!(app_state.renderer.get().is_none());
        assert_eq!(app_state.step_accumulator, 0);
        assert_eq!(app_state.last_step, 0);
    }

    #[test]
    fn test_app_state_first_frame() {
        let mut state = AppState::default();
        state.step_elapsed(Duration::from_millis(UPDATE_TIME_US as u64));
        assert_eq!(state.last_step, 1);
    }

    #[test]
    fn test_app_state_max_ticks() {
        let now = Instant::now();
        let mut state = AppState {
            last_step: 1,
            last_update: now - Duration::from_millis(1000),
            ..Default::default()
        };
        state.step_elapsed(Duration::from_millis(UPDATE_TIME_US as u64));
        assert_eq!(state.last_step, 21);
    }
}
