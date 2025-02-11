use {
    crate::{
        events::{Event, EventRegistry},
        layer::LayerDyn,
        logging,
        Layer,
        DEFAULT_APP_NAME,
        DEFAULT_WINDOW_SIZE,
        STEP_TIME_US,
        UPDATE_TIME_US,
    },
    anyhow::{anyhow, Result},
    derive_more::Debug,
    human_panic::setup_panic,
    std::{
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

#[derive(Clone, Debug)]

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

#[derive(Debug)]
pub struct TickEvent {}
impl Event for TickEvent {}

#[allow(dead_code)]
pub struct App {
    event_registry: EventRegistry,
    pub(crate) layers: Vec<Box<dyn LayerDyn>>,
    last_update: Instant,
    total_steps: u64,
    step_accumulator: i64,
    config: AppConfig,
}

impl App {
    pub fn new(config: AppConfig) -> Self {
        logging::setup_logger().expect("Failed to setup logging");
        setup_panic!();

        App {
            event_registry: EventRegistry::default(),
            last_update: Instant::now(),
            layers: vec![],
            total_steps: 0,
            step_accumulator: 0,
            config,
        }
    }

    pub fn with_layer<T: Layer>(mut self, layer: T) -> Self {
        self.layers.push(Box::new(layer));
        self
    }

    pub fn run(&mut self) -> Result<()> {
        let event_loop = EventLoop::new().expect("Failed to create event loop");
        event_loop
            .run_app(&mut AppHandler::new(self))
            .map_err(|err| anyhow!(err))
    }

    fn init(&mut self, event_loop: &ActiveEventLoop) -> Result<()> {
        log::info!("Initializing app...");

        let window_attributes = Window::default_attributes()
            .with_inner_size(DEFAULT_WINDOW_SIZE)
            .with_title(self.config.name.clone());
        let window = Arc::new(event_loop.create_window(window_attributes)?);

        for (index, layer) in self.layers.iter_mut().enumerate() {
            layer.init_dyn(window.clone(), &mut self.event_registry, index)?;
        }

        Ok(())
    }

    pub fn emit<T: Event>(&mut self, event: &T) {
        self.event_registry
            .emit(&mut self.layers, event)
            .expect("Error emitting event");
    }

    fn update_frame_timing(&mut self) {
        // ...
    }
}

struct AppHandler<'a> {
    app: &'a mut App,
    wait_canceled: bool,
    close_requested: bool,
}
impl<'a> AppHandler<'a> {
    fn new(app: &'a mut App) -> Self {
        AppHandler {
            app,
            wait_canceled: false,
            close_requested: false,
        }
    }
}

impl ApplicationHandler for AppHandler<'_> {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        self.app.init(event_loop).expect("Error initializing app");
    }

    fn new_events(&mut self, _event_loop: &ActiveEventLoop, cause: winit::event::StartCause) {
        if cause == winit::event::StartCause::Init {
            return;
        }

        self.wait_canceled = match cause {
            winit::event::StartCause::ResumeTimeReached { .. } => false,
            winit::event::StartCause::WaitCancelled { .. } => true,
            _ => false,
        };

        self.app.update_frame_timing();
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if self.close_requested {
            log::info!("Exiting on user request");
            event_loop.exit();
        }

        self.app.emit(&TickEvent {});
        
        if !self.wait_canceled {
            event_loop.set_control_flow(ControlFlow::WaitUntil(
                Instant::now() + Duration::from_millis(1),
            ));
        }
    }

    fn window_event(
        &mut self,
        _event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        event: WindowEvent,
    ) {
        match event {
            WindowEvent::CloseRequested => {
                self.close_requested = true;
            }
            _ => {}
        }

        self.app.emit(&WinitEvent::WindowEvent(event));
    }
}

#[derive(Debug)]
pub enum WinitEvent {
    WindowEvent(WindowEvent),
}
impl Event for WinitEvent {}

pub struct UpdateLayer {
    last_update: Instant,
    total_steps: u64,
    step_accumulator: i64,
}

impl Default for UpdateLayer {
    fn default() -> Self {
        Self {
            last_update: Instant::now(),
            total_steps: 0,
            step_accumulator: 0,
        }
    }
}
impl Layer for UpdateLayer {
    fn init(
        &mut self,
        _window: Arc<Window>,
        mut events: crate::events::EventSubscriber<Self>,
    ) -> anyhow::Result<()> {
        events.subscribe::<TickEvent>(|layer, _event| {
            layer.update()?;
            Ok(())
        });

        Ok(())
    }
}

impl UpdateLayer {
    fn update(&mut self) -> Result<()> {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_update);
        self.step_elapsed(elapsed);
        self.last_update = now;

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
}
