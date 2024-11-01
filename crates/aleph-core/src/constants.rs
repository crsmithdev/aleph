use winit::dpi::{PhysicalSize, Size};

pub const VK_API_DUMP: bool = true;
pub const VK_TIMEOUT_NS: u64 = 5_000_000_000;
pub const STEP_TIME_US: u128 = ((1.0 / 60.0) * 1_000_000.0) as u128;
pub const UPDATE_TIME_US: u128 = 20 * STEP_TIME_US;
pub const SINGLE_STEP: bool = true;
pub const DEFAULT_WINDOW_SIZE: Size = Size::Physical(PhysicalSize {
    width: 1280,
    height: 720,
});
pub const DEFAULT_APP_NAME: &'static str = "Untitled (Aleph)";
