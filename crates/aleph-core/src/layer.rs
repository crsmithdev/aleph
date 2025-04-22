pub use winit::window::Window;
use {
    crate::{
        events::{EventRegistry, EventSubscriber},
        system::{Resources, Scheduler},
    },
    downcast_rs::{impl_downcast, Downcast},
    glam::Vec3,
};
pub trait Layer: 'static {
    fn register(
        &mut self,
        scheduler: &mut Scheduler,
        resources: &mut Resources,
        events: &mut EventSubscriber<Self>,
    ) where
        Self: Sized;
}

pub trait LayerDyn: 'static + Downcast {
    fn register(
        &mut self,
        scheduler: &mut Scheduler,
        resources: &mut Resources,
        registry: &mut EventRegistry,
        index: usize,
    );
}
impl_downcast!(LayerDyn);

impl<T: Layer> LayerDyn for T {
    fn register(
        &mut self,
        scheduler: &mut Scheduler,
        resources: &mut Resources,
        registry: &mut EventRegistry,
        index: usize,
    ) {
        let mut subscriber = EventSubscriber::<Self>::new(registry, index);
        self.register(scheduler, resources, &mut subscriber)
    }
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

// type UpdateFn = fn(&mut UpdateContext) -> Result<()>;
// pub struct UpdateLayer {
//     update_fn: UpdateFn,
// }

// impl Layer for UpdateLayer {
//     fn init(&mut self, _ctx: &mut InitContext, _events: &mut EventSubscriber<Self>) -> Result<()> {
//         Ok(())
//     }

//     fn update(&mut self, ctx: &mut UpdateContext) -> anyhow::Result<()> { (self.update_fn)(ctx) }
// }

// impl UpdateLayer {
//     pub fn new(update_fn: UpdateFn) -> Self { Self { update_fn } }
// }

// type InitFn = fn(&mut InitContext) -> Result<()>;
// pub struct InitLayer {
//     init_fn: InitFn,
// }

// impl Layer for InitLayer {
//     fn init(
//         &mut self,
//         ctx: &mut InitContext,
//         _events: &mut EventSubscriber<Self>,
//     ) -> anyhow::Result<()> {
//         (self.init_fn)(ctx)
//     }

//     fn update(&mut self, _ctx: &mut UpdateContext) -> anyhow::Result<()> { Ok(()) }
// }

// impl InitLayer {
//     pub fn new(init_fn: InitFn) -> Self { Self { init_fn } }
// }
