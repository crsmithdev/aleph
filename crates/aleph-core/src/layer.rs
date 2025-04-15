pub use winit::window::Window;
use {
    crate::{
        events::{EventRegistry, EventSubscriber},
        input::InputState,
    },
    anyhow::Result,
    downcast_rs::{impl_downcast, Downcast},
    glam::Vec3,
    std::sync::Arc,
};
pub trait Layer: 'static {
    fn init(&mut self, window: Arc<Window>, events: EventSubscriber<Self>) -> Result<()>
    where
        Self: Sized;

    fn update(&mut self, ctx: &mut UpdateContext) -> Result<()>;
}

pub trait LayerDyn: 'static + Downcast {
    fn register(
        &mut self,
        window: Arc<Window>,
        events: &mut EventRegistry,
        index: usize,
    ) -> anyhow::Result<()>;

    fn update(&mut self, ctx: &mut UpdateContext) -> anyhow::Result<()>;
}
impl_downcast!(LayerDyn);

impl<T: Layer> LayerDyn for T {
    fn register(
        &mut self,
        window: Arc<Window>,
        events: &mut EventRegistry,
        index: usize,
    ) -> anyhow::Result<()> {
        self.init(window, EventSubscriber::new(events, index))
    }

    fn update(&mut self, ctx: &mut UpdateContext) -> anyhow::Result<()> { self.update(ctx) }
}

pub struct UpdateContext {
    pub input: InputState,
    pub scene: Box<dyn Scene>,
}

pub trait SceneObject {
    fn rotate(&mut self, delta: f32);
}

pub trait Scene: 'static + Downcast {
    fn objects(&self) -> Vec<Box<dyn SceneObject>>;
    fn rotate_camera(&mut self, delta: glam::Vec2);
    fn translate_camera(&mut self, delta: Vec3);
}

impl_downcast!(Scene);

type UpdateFn = fn(&mut UpdateContext) -> Result<()>;
pub struct UpdateLayer {
    update_fn: UpdateFn,
}

impl Layer for UpdateLayer {
    fn init(
        &mut self,
        _window: Arc<Window>,
        mut _events: EventSubscriber<Self>,
    ) -> anyhow::Result<()> {
        Ok(())
    }

    fn update(&mut self, ctx: &mut UpdateContext) -> anyhow::Result<()> { (self.update_fn)(ctx) }
}

impl UpdateLayer {
    pub fn new(update_fn: UpdateFn) -> Self { Self { update_fn } }
}
