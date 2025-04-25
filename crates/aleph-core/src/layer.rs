pub use winit::window::Window;

use crate::system::{Resources, Scheduler};
pub trait Layer: 'static {
    fn register(&mut self, scheduler: &mut Scheduler, resources: &mut Resources);
}
