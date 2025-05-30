use {
    crate::{Gui, Renderer},
    aleph_core::{
        events::{EventReader, GuiEvent, ResizedEvent},
        layer::Layer,
        system::{Res, ResMut, Resources, Schedule, Scheduler},
        Window,
    },
    aleph_scene::{assets::Assets, Scene},
    aleph_vk::Gpu,
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
    gui_events: EventReader<GuiEvent>,
    resized_events: EventReader<ResizedEvent>,
    mut assets: ResMut<Assets>,
    mut gui: ResMut<Gui>,
    mut renderer: ResMut<Renderer>,
) {
    let gui_events = gui_events.read();
    gui.handle_events(gui_events);

    let resized_event = resized_events.last();
    if let Some(event) = resized_event {
        renderer.resize(event.width, event.height);
    }

    renderer.render(&scene, &mut assets, &mut gui).expect("execute renderer");
}
