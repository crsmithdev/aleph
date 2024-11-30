use {
    aleph_core::{
        constants::{DEFAULT_WINDOW_SIZE, STEP_TIME_US, UPDATE_TIME_US},
        logging,
    },
    aleph_gfx::{renderer::Renderer, ui::UI},
    aleph_hal::vk::RenderBackend,
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
    event::{Event,WindowEvent},
        event_loop::{ActiveEventLoop, ControlFlow, EventLoop},
        window::{Window, WindowId},
    },
};

#[derive(Debug, Default)]
pub struct App {}

impl App {
    pub fn run(&mut self) -> Result<()> {
        logging::setup_logger()?;
        setup_panic!();

        let state = AppState::default();
        let mut handler = AppHandler { state };

        EventLoop::new()?
            .run_app(&mut handler)
            .map_err(|err| anyhow!(err))
    }
}

pub struct Context {}

#[allow(dead_code)]
pub struct AppState {
    renderer: OnceCell<Renderer>,
    ui: OnceCell<UI>,
    window: OnceCell<Arc<Window>>,
    last_update: Instant,
    last_step: u64,
    last_frame: u64,
    last_heartbeat: u64,
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
            last_heartbeat: 0,
            last_step: 0,
            last_frame: 0,
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
            .field("last_step", &self.last_step)
            .field("step_accumulator", &self.step_accumulator)
            .field("last_heartbeat", &self.last_heartbeat)
            .field("last_frame", &self.last_frame)
            .field("exiting", &self.exiting)
            .field("initialized", &self.initialized)
            .finish()
    }
}

impl AppState {
    pub fn init(&mut self, event_loop: &ActiveEventLoop) -> Result<()> {
        let attributes = Window::default_attributes().with_inner_size(DEFAULT_WINDOW_SIZE);
        let window = Arc::new(event_loop.create_window(attributes)?);
        log::info!("Created window: {window:?}");

        let backend = RenderBackend::new(&window.clone())?;
        log::info!("Created render backend: {:?}", &backend);

        let ui = UI::new(&backend, &window)?;
        log::info!("Created UI: {:?}", &ui);

        let renderer = Renderer::new(backend)?;
        log::info!("Created renderer: {:?}", &renderer);

        self.window
            .set(window)
            .map_err(|_| anyhow!("Window already initialized"))?;
        self.renderer
            .set(renderer)
            .map_err(|_| anyhow!("Renderer already initialized"))?;
        self.ui
            .set(ui)
            .map_err(|_| anyhow!("UI already initialized"))?;
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
        let window = self.window.get().unwrap();

        let renderer = self
            .renderer
            .get_mut()
            .expect("Renderer dropped or not initialized");
        let ui = self.ui.get_mut().expect("UI dropped or not initialized");

        renderer.begin_frame()?;
        renderer.render()?;
        ui.render(window)?;
        renderer.end_frame()?;

        self.last_frame = self.last_frame.wrapping_add(1);

        Ok(())
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
        if !self.exiting {
            self.exiting = true;
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

impl ApplicationHandler for AppHandler {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        log::info!("Resumed");
        if let Err(err) = self.state.init(event_loop) {
            log::error!("Failed to initialize app state: {err}");
            event_loop.exit();
        }
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

        let window = self.state.window.get().unwrap();
        let ui = self.state.ui.get_mut().unwrap();
        let event2 = event.clone();
        let event3 = Event::WindowEvent { window_id: window_id, event: event2 };
        // let event2: Event<()> = Event::WindowEvent { event: event.clone(), window_id };
        // let event2: Event<()> = Event::WindowEvent { event, window_id };
        // ui.handle_event(window, event2);

        match event {
            WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
                log::info!("Window scale factor changed: {scale_factor}");
            }
            WindowEvent::RedrawRequested => {
                log::info!("Window redraw requested");
                // self.state.render().expect("Rendering error");
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
            }
            _ => {}
        }

        ui.handle_event(window, event3);
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
