pub mod app;

use winit::dpi::{PhysicalSize, Size};

pub const DEFAULT_APP_NAME: &str = "Untitled (Aleph)";
pub const DEFAULT_WINDOW_SIZE: Size = Size::Physical(PhysicalSize {
    width: 1920,
    height: 1200,
});

pub use {
    app::{App, AppConfig},
    winit::window::Window,
};
