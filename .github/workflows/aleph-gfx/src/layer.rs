use {
    crate::{Gui, Renderer},
    aleph_core::{
        events::{EventReader, GuiEvent},
        layer::Layer,
        system::{Res, ResMut, Resources, Schedule, Scheduler},
        Window,
    },
    aleph_scene::{assets::Assets, Scene},
    aleph_vk::{Extent2D, Gpu},
    std::sync::Arc,
};

#[derive(Default)]
pub struct RenderLayer {}

impl Layer for RenderLayer {
    fn register(&mut self, scheduler: &mut Scheduler, resources: &mut Resources) {
        let window = Arc::clone(resources.get::<Arc<Window>>());
        let gpu = Arc::new(Gpu::new(Arc::clone(&window)).expect("Error creating gpu"));

        resources.add(Renderer::new(Arc::clone(&gpu)).expect("Error creating renderer"));
        resources.add(Assets::new(Arc::clone(&gpu)).expect("Error creating assets"));
        resources.add(Gui::new(&gpu, Arc::clone(&window)).expect("Failed to create GUI"));
        resources.add(Scene::default());
        resources.add(Arc::clone(&gpu));

        scheduler.add_system(Schedule::Default, update_system);
    }
}

fn update_system(
    scene: Res<Scene>,
    events: EventReader<GuiEvent>,
    mut assets: ResMut<Assets>,
    mut gui: ResMut<Gui>,
    mut renderer: ResMut<Renderer>,
    window: Res<Arc<Window>>,
) {
    gui.handle_events(events.read());
    if !renderer.prepared {
        renderer.prepare_bindless(&mut assets, &scene).expect("Error preparing resources");
        renderer.prepared = true;
    }
    let extent = window.inner_size();
    let extent = Extent2D {
        width: extent.width,
        height: extent.height,
    };
    renderer.render(&scene, &mut assets, &mut gui, extent).expect("execute renderer");
}
