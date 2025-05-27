use {
    aleph_core::{
        events::{Event, EventRegistry, Events, GuiEvent},
        input::Input,
        log,
        system::{IntoSystem, Resources, Schedule, Scheduler, System},
        Layer,
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
        dpi::{PhysicalSize, Size},
        event::WindowEvent,
        event_loop::{ActiveEventLoop, ControlFlow, EventLoop},
        window::{Window, WindowId},
    },
};

const DEFAULT_APP_NAME: &str = "Untitled (Aleph)";
const DEFAULT_WINDOW_SIZE: Size = Size::Physical(PhysicalSize {
    width: 1920,
    height: 1200,
});

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
#[allow(dead_code)]
pub struct App {
    event_registry: EventRegistry,
    scheduler: Scheduler,
    resources: Resources,
    pub(crate) layers: Vec<Box<dyn Layer + 'static>>,
    last_update: Instant,
    total_steps: u64,
    step_accumulator: i64,
    config: AppConfig,
    closing: bool,
}

impl App {
    pub fn new(config: AppConfig) -> Self {
        log::setup_logging();
        setup_panic!();

        App {
            event_registry: EventRegistry::default(),
            scheduler: Scheduler::default(),
            resources: Resources::default(),
            last_update: Instant::now(),
            layers: vec![],
            total_steps: 0,
            step_accumulator: 0,
            closing: false,
            config,
        }
    }

    pub fn with_layer<T: Layer + 'static>(mut self, layer: T) -> Self {
        self.layers.push(Box::new(layer) as Box<dyn Layer>);
        self
    }

    pub fn with_system<I, S: System + 'static>(
        mut self,
        schedule: Schedule,
        system: impl IntoSystem<I, System = S>,
    ) -> Self {
        self.scheduler.add_system(schedule, system);
        self
    }

    pub fn with_event<T: Event + 'static>(mut self) {
        self.event_registry.register::<T>(&mut self.resources);
    }

    pub fn run(&mut self) -> Result<()> {
        let event_loop = EventLoop::new().expect("Failed to create event loop");
        event_loop.run_app(&mut AppHandler::new(self)).map_err(|err| anyhow!(err))
    }

    fn init(&mut self, event_loop: &ActiveEventLoop) -> Result<()> {
        log::info!("Initializing app...");

        let attributes = Window::default_attributes()
            .with_inner_size(DEFAULT_WINDOW_SIZE)
            .with_title(self.config.name.clone());
        let window = Arc::new(event_loop.create_window(attributes)?);
        self.resources.add(window);

        self.resources.add(Input::default());
        self.event_registry.register::<GuiEvent>(&mut self.resources);

        for layer in self.layers.iter_mut() {
            layer.register(&mut self.scheduler, &mut self.resources);
        }

        self.scheduler.run(Schedule::Startup, &mut self.resources);

        Ok(())
    }

    fn next_frame(&mut self) -> Result<()> {
        let input = self.resources.get_mut::<Input>();
        input.next_frame();

        self.event_registry.next_frame(&self.resources);
        self.scheduler.run(Schedule::Default, &mut self.resources);

        Ok(())
    }

    fn exit(&mut self, event_loop: &ActiveEventLoop) {
        if !self.closing {
            self.closing = true;
            log::info!("Exiting on user request");

            event_loop.exit();
        }
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
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if self.close_requested {
            log::info!("Exiting on user request");
            event_loop.exit();
        }

        if let Err(err) = self.app.next_frame() {
            log::error!("Error executing systems: {:?}", err);
            self.app.exit(event_loop);
        }

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
        let input = self.app.resources.get_mut::<Input>();
        input.handle_window_event(&event);

        let events = self.app.resources.get_mut::<Events<GuiEvent>>();
        events.write(GuiEvent(event.clone()));

        if let WindowEvent::CloseRequested = event {
            self.close_requested = true;
        }
    }

    fn device_event(
        &mut self,
        _event_loop: &ActiveEventLoop,
        _device_id: winit::event::DeviceId,
        event: winit::event::DeviceEvent,
    ) {
        let input = self.app.resources.get_mut::<Input>();
        input.handle_device_event(&event);
    }
}
