use {
    aleph_core::logging,
    aleph_gfx::renderer::Renderer,
    aleph_hal::vk::RenderBackend,
    anyhow::{anyhow, bail, Ok, Result},
    human_panic::setup_panic,
    std::{
        cell::OnceCell,
        fmt,
        iter::Once,
        panic,
        process::exit,
        sync::Arc,
        time::{Duration, Instant},
    },
    winit::{
        application::ApplicationHandler,
        dpi::{PhysicalSize, Size},
        event::{self, Event, WindowEvent},
        event_loop::{self, ActiveEventLoop, ControlFlow, EventLoop},
        window::{Window, WindowAttributes, WindowId},
    },
};

macro_rules! try_set {
    ($cell:expr, $value:expr) => {
        match $cell.get() {
            None => {
                $cell.set($value);
                $value
            }
            Some(s) => bail!("e"),
        }
    };
}

const STEP_TIME_US: u128 = ((1.0 / 60.0) * 1_000_000.0) as u128;
const UPDATE_TIME_US: u128 = 20 * STEP_TIME_US;
const INITIAL_SIZE: Size = Size::Physical(PhysicalSize {
    width: 1280,
    height: 720,
});

pub struct App {
    state: AppState,
}

pub struct AppBuilder {}

impl AppBuilder {
    pub fn build(self) -> Result<App> {
        App::build(self)
    }
}

impl Default for App {
    fn default() -> Self {
        App {
            state: AppState::default(),
        }
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
        EventLoop::new()?
            .run_app(&mut self.state)
            .map_err(|err| anyhow!(err))
    }
}

pub struct FrameContext {}

pub struct AppState {
    renderer: OnceCell<Renderer>,
    window: OnceCell<Arc<Window>>,
    last_update: Instant,
    last_step: u64,
    step_accumulator: i64,
}

impl fmt::Debug for AppState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppState")
            .field("renderer", &self.renderer)
            .field("window", &self.window)
            .field("last_update", &self.last_update)
            .field("last_step", &self.last_step)
            .field("step_accumulator", &self.step_accumulator)
            .finish()
    }
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            window: OnceCell::new(),
            renderer: OnceCell::new(),
            last_update: Instant::now(),
            step_accumulator: 0,
            last_step: 0,
        }
    }
}

impl AppState {
    pub fn init(&mut self, event_loop: &ActiveEventLoop) -> Result<()> {
        let attributes = Window::default_attributes().with_inner_size(INITIAL_SIZE);
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
        let elapsed = now.duration_since(self.last_update);

        self.step_elapsed(elapsed);
        self.render();

        self.last_update = now;
    }

    fn render(&mut self) {
        match self.renderer.get() {
            Some(renderer) => renderer.render(),
            None => {
                log::error!("Renderer not initialized");
            }
        }
    }

    fn step_elapsed(&mut self, elapsed: Duration) {
        let mut steps = 0;
        let elapsed_us = elapsed.as_micros().min(UPDATE_TIME_US);

        self.step_accumulator = match self.last_step {
            0 => STEP_TIME_US as i64,
            _ => self.step_accumulator + elapsed_us as i64,
        };

        while self.step_accumulator >= STEP_TIME_US as i64 {
            self.step_accumulator -= STEP_TIME_US as i64;
            self.step();
            self.last_step += 1;
            steps += 1;
        }

        if steps > 0 || elapsed_us >= UPDATE_TIME_US {
            log::trace!(
                "Step: {}, accumulator: {}, elapsed us: {}, max: {}",
                self.last_step,
                self.step_accumulator,
                elapsed_us,
                elapsed_us >= UPDATE_TIME_US
            );
        }
    }

    fn step(&mut self) {
        // ...
    }

    fn exit(&mut self, event_loop: &ActiveEventLoop) {
        log::info!("Exiting");
        let _ = self.renderer.take();
        let _ = self.window.take();
        event_loop.exit();
    }
}

impl ApplicationHandler for AppState {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        log::info!("Resumed");
        if let Err(err) = self.init(event_loop) {
            log::error!("Failed to initialize app state: {err}");
            event_loop.exit();
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        self.update(Instant::now());
        event_loop.set_control_flow(ControlFlow::WaitUntil(
            Instant::now() + Duration::from_millis(1),
        ));
    }

    fn exiting(&mut self, event_loop: &ActiveEventLoop) {
        self.exit(event_loop);
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        event: WindowEvent,
    ) {
        // event_loop.set_control_flow(ControlFlow::Poll);
        if let Some(_) = self.window.get() {
            match event {
                WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
                    log::info!("Window scale factor changed: {scale_factor}");
                }
                WindowEvent::RedrawRequested => {
                    log::info!("Window redraw requested");
                    self.render();
                }
                WindowEvent::CloseRequested => {
                    log::info!("Close requested");
                    event_loop.exit();
                }
                WindowEvent::KeyboardInput { event, .. } => {
                    log::info!("Keyboard input: {event:?}");
                }
                WindowEvent::MouseInput { button, state, .. } => {
                    log::info!("Mouse input: {button:?}, {state:?}");
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
