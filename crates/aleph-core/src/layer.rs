pub use winit::window::Window;
use {
    crate::events::{EventRegistry, EventSubscriber},
    downcast_rs::{impl_downcast, Downcast},
    std::sync::Arc,
};
pub trait Layer: 'static {
    fn init(&mut self, window: Arc<Window>, events: EventSubscriber<Self>) -> anyhow::Result<()>
    where
        Self: Sized;
}

pub trait LayerDyn: 'static + Downcast {
    fn init_dyn(
        &mut self,
        window: Arc<Window>,
        events: &mut EventRegistry,
        index: usize,
    ) -> anyhow::Result<()>;
}
impl_downcast!(LayerDyn);

impl<T: Layer> LayerDyn for T {
    fn init_dyn(
        &mut self,
        window: Arc<Window>,
        events: &mut EventRegistry,
        index: usize,
    ) -> anyhow::Result<()> {
        self.init(window, EventSubscriber::new(events, index))
    }
}

pub struct InitContext<'a, L> {
    pub window: Arc<winit::window::Window>,
    // pub scene: &'a Scene
    pub events: EventSubscriber<'a, L>,
}
