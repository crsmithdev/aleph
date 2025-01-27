// use {
//     crate::{DEFAULT_APP_NAME, DEFAULT_WINDOW_SIZE, STEP_TIME_US, UPDATE_TIME_US, layer::LayerDyn},
//     aleph_core::{
//         events::{EventRegistry, EventSubscriber},
//         layer::InitContext,
//         logging,
//     },
//     aleph_gfx::{layer::GraphicsLayer, ui::UiRenderer, Renderer},
//     anyhow::{anyhow, Result},
//     derive_more::Debug,
//     human_panic::setup_panic,
//     std::{
//         sync::{Arc, OnceLock},
//         time::{Duration, Instant},
//     },
//     winit::{
//         application::ApplicationHandler,
//         event::{Event, WindowEvent},
//         event_loop::{ActiveEventLoop, ControlFlow, EventLoop},
//         window::{Window, WindowId},
//     },
// };

// #[derive(Clone, Debug)]

// pub struct AppConfig {
//     pub name: String,
// }

// impl AppConfig {
//     pub fn name(mut self, value: &str) -> Self {
//         self.name = value.to_string();
//         self
//     }
// }

// impl Default for AppConfig {
//     fn default() -> Self {
//         Self {
//             name: DEFAULT_APP_NAME.to_string(),
//         }
//     }
// }

// #[allow(dead_code)]
// // #[derive(Debug)]
// pub struct App {
//     event_registry: EventRegistry,
//     layers: Vec<Box<dyn LayerDyn>>,
//     last_update: Instant,
//     total_steps: u64,
//     step_accumulator: i64,
//     config: AppConfig,
// }

// impl App {
//     pub fn new(config: AppConfig) -> Self {
//         logging::setup_logger().expect("Failed to setup logging");
//         setup_panic!();

//         // TODO remove hardcode
//         let layers =
//             vec![Box::new(aleph_gfx::layer::GraphicsLayer::default()) as Box<dyn LayerDyn>];

//         let app = App {
//             event_registry: EventRegistry::default(),
//             last_update: Instant::now(),
//             layers,
//             total_steps: 0,
//             step_accumulator: 0,
//             config,
//         };

//         // log::info!("Created app: {:?}", &app);
//         app
//     }

//     #[deprecated(since = "0.1.0", note = "shame")]
//     fn gfx(&mut self) -> &mut GraphicsLayer {
//         self.layers[0]
//             .downcast_mut::<GraphicsLayer>()
//             .expect("Could not access graphics layer")
//     }

//     pub fn run(&mut self) -> Result<()> {
//         log::info!("Running app");

//         let event_loop = EventLoop::new().expect("Failed to create event loop");
//         event_loop
//             .run_app(&mut AppHandler::new(self))
//             .map_err(|err| anyhow!(err))
//     }

//     fn init(&mut self, event_loop: &ActiveEventLoop) -> Result<()> {
//         log::info!("Initializing app");

//         let window_attributes = Window::default_attributes()
//             .with_inner_size(DEFAULT_WINDOW_SIZE)
//             .with_title(self.config.name.clone());
//         let window = Arc::new(event_loop.create_window(window_attributes)?);

//         for (index, layer) in self.layers.iter_mut().enumerate() {
//             log::info!("Initializing layer: {:?}", std::any::type_name_of_val(layer));
//             layer.init_dyn(window.clone(), &mut self.event_registry, index)?;
//         }

//         Ok(())
//     }

//     fn update(&mut self) -> Result<()> {
//         let now = Instant::now();
//         let elapsed = now.duration_since(self.last_update);
//         self.step_elapsed(elapsed);
//         self.last_update = now;

//         Ok(())
//     }

//     // fn ui(&mut self) -> &mut UiRenderer {
//     //     self.gfx().renderer().ui_mut()
//     // }

//     fn render(&mut self) -> Result<()> {
//         self.gfx().renderer().render()
//     }

//     fn step_elapsed(&mut self, elapsed: Duration) {
//         let elapsed_us = elapsed.as_micros().min(UPDATE_TIME_US);

//         self.step_accumulator = match self.total_steps {
//             0 => STEP_TIME_US as i64,
//             _ => self.step_accumulator + elapsed_us as i64,
//         };

//         while self.step_accumulator >= STEP_TIME_US as i64 {
//             self.step_accumulator -= STEP_TIME_US as i64;
//             self.step();
//             self.total_steps += 1;
//         }
//     }

//     fn step(&mut self) {
//         // ...
//     }

//     fn update_frame_timing(&mut self) {
//         self.gfx().renderer().ui_mut().update_delta_time();
//         // ...
//     }
// }

// struct AppHandler<'a> {
//     app: &'a mut App,
//     wait_canceled: bool,
// }
// impl<'a> AppHandler<'a> {
//     fn new(app: &'a mut App) -> Self {
//         AppHandler {
//             app,
//             wait_canceled: false,
//         }
//     }
// }

// impl ApplicationHandler for AppHandler<'_> {
//     fn resumed(&mut self, event_loop: &ActiveEventLoop) {
//         self.app.init(event_loop).expect("Error initializing app");
//     }

//     fn new_events(&mut self, _event_loop: &ActiveEventLoop, cause: winit::event::StartCause) {
//         if cause == winit::event::StartCause::Init {
//             return;
//         }

//         self.wait_canceled = match cause {
//             winit::event::StartCause::ResumeTimeReached { .. } => false,
//             winit::event::StartCause::WaitCancelled { .. } => true,
//             _ => false,
//         };

//         self.app.update_frame_timing();
//     }

//     fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
//         self.app.update().expect("Error updating app state");
//         self.app.render().expect("Error rendering app state");

//         // self.app.event_registry.emit(&TickEvent(Instant::now())).expect("subscribe");//
//         // ::<TickEvent>();
//         if !self.wait_canceled {
//             event_loop.set_control_flow(ControlFlow::WaitUntil(
//                 Instant::now() + Duration::from_millis(1),
//             ));
//         }
//     }

//     fn window_event(
//         &mut self,
//         event_loop: &ActiveEventLoop,
//         window_id: WindowId,
//         event: WindowEvent,
//     ) {
//         match event {
//             // WindowEvent::RedrawRequested => {
//             // log::info!("Window redraw requested");
//             // ...
//             // }
//             WindowEvent::CloseRequested => {
//                 log::info!("Exiting on request");
//                 event_loop.exit();
//             }
//             WindowEvent::Resized(size) => {
//                 log::info!("Window resized to {size:?}");
//                 // ...
//             }
//             _ => {
//                 log::info!("Unhandled window event: {event:?}");
//             }
//         }

//         let event2: winit::event::Event<()> = winit::event::Event::WindowEvent { window_id, event };
//         self.app.gfx().renderer().ui_mut().handle_event(event2);
//     }
// }
