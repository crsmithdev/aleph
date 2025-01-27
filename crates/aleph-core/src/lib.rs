pub mod app;
pub mod constants;
pub mod events;
pub mod layer;
pub mod logging;

use winit::dpi::{PhysicalSize, Size};

pub(crate) const STEP_TIME_US: u128 = ((1.0 / 60.0) * 1_000_000.0) as u128;
pub(crate) const UPDATE_TIME_US: u128 = 20 * STEP_TIME_US;
pub const DEFAULT_APP_NAME: &str = "Untitled (Aleph)";
pub const DEFAULT_WINDOW_SIZE: Size = Size::Physical(PhysicalSize {
    width: 1280,
    height: 720,
});

pub use {
    app::{App, AppConfig, UpdateLayer},
    events::Event,
    layer::Layer,
    logging::setup_logger,
};
