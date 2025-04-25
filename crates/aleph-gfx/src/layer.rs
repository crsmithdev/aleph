use {
    crate::{
        gui::Gui,
        renderer::{Renderer, RendererConfig},
    },
    aleph_core::{
        events::{EventReader, GuiEvent},
        layer::Layer,
        system::{Res, ResMut, Resources, Schedule, Scheduler},
        Window,
    },
    aleph_scene::{assets::Assets, Scene},
    aleph_vk::Gpu,
    anyhow::Result,
    std::{path::Path, sync::Arc},
};

pub fn path_to_scene(name: &str) -> Result<String> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(GLTF_SAMPLE_DIR)
        .join(name)
        .join("glTF")
        .join(format!("{name}.gltf"));

    let path = path.canonicalize();
    path.as_ref()
        .clone()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|_| anyhow::anyhow!("Invalid path: {:?}", path))
}

const GLTF_SAMPLE_DIR: &str = "submodules/glTF-Sample-Assets/Models";
#[derive(Default)]
pub struct RenderLayer {
    config: RendererConfig,
}

impl RenderLayer {
    pub fn with_config(config: RendererConfig) -> Self { Self { config: config } }
}

impl Layer for RenderLayer {
    fn register(&mut self, scheduler: &mut Scheduler, resources: &mut Resources) {
        let gpu = match Gpu::new(Arc::clone(&resources.get::<Arc<Window>>())) {
            Ok(gpu) => Arc::new(gpu),
            Err(err) => panic!("Fatal error creating gpu: {err:?}"),
        };

        let renderer = match Renderer::new(Arc::clone(&gpu), self.config.clone()) {
            Ok(renderer) => renderer,
            Err(err) => panic!("Fatal error creating renderer: {err:?}"),
        };

        let assets = Assets::new(Arc::clone(&gpu)).expect("assets");
        resources.add(assets);

        let scene = Scene::default();
        resources.add(scene);

        let gui = Gui::new(&gpu, Arc::clone(&resources.get::<Arc<Window>>()))
            .expect("Failed to create GUI");
        resources.add(gui);

        resources.add(renderer);
        resources.add(Arc::clone(&gpu));

        scheduler.add_system(
            Schedule::Default,
            move |mut renderer: ResMut<Renderer>,
                  scene: Res<Scene>,
                  events: EventReader<GuiEvent>,
                  mut assets: ResMut<Assets>,
                  mut gui: ResMut<Gui>| {
                for event in events.read() {
                    gui.on_window_event(&event.event);
                }
                renderer
                    .execute(&scene, &mut assets, &mut gui)
                    .expect("execute renderer");
            },
        );
    }
}
