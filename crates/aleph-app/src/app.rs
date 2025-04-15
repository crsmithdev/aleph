use {
    crate::{DEFAULT_APP_NAME, DEFAULT_WINDOW_SIZE},
    aleph_core::{
        events::{Event, EventRegistry, GuiEvent},
        input::{Input, InputState},
        layer::{LayerDyn, UpdateContext},
        log, Layer,
    },
    aleph_scene::SceneGraph,
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
    pub initial_scene: Option<String>,
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
            initial_scene: None,
        }
    }
}
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
        log::setup();
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
            layer.register(window.clone(), &mut self.event_registry, index)?;
        }

        Ok(())
    }

    pub fn emit<T: Event>(&mut self, event: &T) {
        self.event_registry
            .emit(&mut self.layers, event)
            .expect("Error emitting event");
    }
}

struct AppHandler<'a> {
    app: &'a mut App,
    wait_canceled: bool,
    close_requested: bool,
    context: UpdateContext,
    input: Input,
}
impl<'a> AppHandler<'a> {
    fn new(app: &'a mut App) -> Self {
        AppHandler {
            app,
            wait_canceled: false,
            close_requested: false,
            input: Input::default(),
            context: UpdateContext {
                input: InputState::default(),
                scene: Box::new(SceneGraph::default()),
            },
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

        let input = self.input.next_frame();
        let context = &mut self.context;
        context.input = input;
        self.app.layers.iter_mut().for_each(|layer| {
            layer.update(context).expect("Error updating layer");
        });

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
        self.input.handle_window_event(&event);
        self.app.emit(&GuiEvent {
            event: event.clone(),
        });

        #[allow(clippy::single_match)]
        match event {
            WindowEvent::CloseRequested => {
                self.close_requested = true;
            }
            _ => {}
        }
    }

    fn device_event(
        &mut self,
        _event_loop: &ActiveEventLoop,
        _device_id: winit::event::DeviceId,
        event: winit::event::DeviceEvent,
    ) {
        self.input.handle_device_event(&event);
    }
}
