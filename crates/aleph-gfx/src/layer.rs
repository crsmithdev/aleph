use {
    crate::{Gui, Renderer},
    aleph_core::{
        events::{EventReader, GuiEvent},
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
        let assets = Assets::new(Arc::clone(&gpu)).expect("Error creating assets");
        let renderer = Renderer::new(Arc::clone(&gpu)).expect("Error creating renderer");
        let gui = Gui::new(Arc::clone(&gpu), Arc::clone(&window)).expect("Error creating GUI");
        let scene = Scene::default();

        resources.add(assets);
        resources.add(renderer);
        resources.add(gui);
        resources.add(gpu);
        resources.add(scene);

        scheduler.add_system(Schedule::Default, update_system);
        log::debug!("END OF RENDER LAYER REGISTER")
    }
}

fn update_system(
    scene: Res<Scene>,
    events: EventReader<GuiEvent>,
    mut assets: ResMut<Assets>,
    mut gui: ResMut<Gui>,
    mut renderer: ResMut<Renderer>,
) {
    gui.handle_events(events.read());
    if !renderer.prepared {
        renderer
            .prepare_resources(&mut assets, &scene)
            .expect("Error preparing resources");
        renderer.prepared = true;
    }
    renderer
        .render(&scene, &mut assets, &mut gui)
        .expect("execute renderer");
}
