pub mod forward;
pub mod debug;
pub mod renderer;
pub mod gui;

pub use crate::render::{forward::ForewardPipeline, debug::DebugPipeline, renderer::Renderer};
