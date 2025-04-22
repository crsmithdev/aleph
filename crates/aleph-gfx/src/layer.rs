// use {
//     crate::renderer::{Renderer, RendererConfig},
//     aleph_core::{
//         events::GuiEvent,
//         layer::{Layer, Scene, UpdateContext, Window},
//     },
//     aleph_scene::{gltf, Scene},
//     aleph_vk::Gpu,
//     anyhow::Result,
//     std::sync::{Arc, OnceLock},
// };

// #[derive(Default)]
// pub struct RenderLayer {
//     config: RendererConfig,
//     renderer: OnceLock<Renderer>,
// }

// impl RenderLayer {
//     pub fn with_config(config: RendererConfig) -> Self {
//         Self {
//             config: config,
//             renderer: OnceLock::new(),
//             // scene: Scene::default(),
//         }
//     }
// }

// impl Layer for RenderLayer {
//     // fn init(
//     //     &mut self,
//     //     window: Arc<Window>,
//     //     mut events: aleph_core::events::EventSubscriber<Self>,
//     // ) -> anyhow::Result<()>
//     // where
//     //     Self: Sized,
//     // {
//     // }

//     // fn update(&mut self, ctx: &mut UpdateContext) -> anyhow::Result<()> {
//     //     let renderer = self.renderer.get().unwrap();

//     //     if let Some(path) = self.config.initial_scene.as_ref() {
//     //         let scene: Scene = gltf::load(&renderer.gpu, path)?;
//     //         let boxed: Box<dyn Scene> = Box::new(scene);
//     //         ctx.scene = boxed;
//     //         self.config.initial_scene = None;
//     //     }

//     //     let scene = ctx.scene.downcast_ref::<Scene>().unwrap();
//     //     self.render(scene)?;
//     //     Ok(())
//     // }

//     fn register(
//         &mut self,
//         scheduler: &mut aleph_core::system::Scheduler,
//         resources: &mut aleph_core::system::Resources,
//         events: &mut aleph_core::events::EventSubscriber<Self>,
//     ) where
//         Self: Sized,
//     {
//         let gpu = Gpu::new(Arc::clone(&window))?;
//         let renderer = Renderer::new(gpu, self.config.clone())?;
//         self.renderer
//             .set(renderer)
//             .map_err(|_| anyhow::anyhow!("Failed to set renderer"))?;
//         events.subscribe::<GuiEvent>(move |layer, event| {
//             layer
//                 .renderer
//                 .get_mut()
//                 .expect("renderer")
//                 .gui
//                 .on_window_event(&event.event);
//             Ok(())
//         });

//         Ok(())
//     }
// }

// impl RenderLayer {
//     pub fn render(&mut self, scene: &Scene) -> Result<()> {
//         self.renderer
//             .get_mut()
//             .expect("Renderer not initialized")
//             .execute(scene)
//     }
// }

use {
    crate::renderer::{Renderer, RendererConfig},
    aleph_core::{
        events::EventSubscriber,
        layer::Layer,
        system::{Res, ResMut, Resources, Schedule, Scheduler},
        Window,
    },
    aleph_scene::{assets::Assets, gltf, Scene},
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
    println!("{:?}", path);

    let path = path.canonicalize();
    println!("path: {:?}", path);
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
    fn register(
        &mut self,
        scheduler: &mut Scheduler,
        resources: &mut Resources,
        _events: &mut EventSubscriber<Self>,
    ) {
        let window = Arc::clone(&resources.get::<Arc<Window>>());
        let gpu = match Gpu::new(window) {
            Ok(gpu) => Arc::new(gpu),
            Err(err) => panic!("Fatal error creating gpu: {err:?}"),
        };
        let renderer = match Renderer::new(Arc::clone(&gpu), self.config.clone()) {
            Ok(renderer) => renderer,
            Err(err) => panic!("Fatal error creating renderer: {err:?}"),
        };
        let mut assets = Assets::new(Arc::clone(&gpu)).expect("assets");
        let path = path_to_scene("BoxTextured").unwrap();
        let desc = gltf::load_scene(&path, &mut assets).unwrap();
        let mut scene = Scene::default();
        scene.load(desc);

        resources.add(scene);
        resources.add(assets);
        resources.add(renderer);
        resources.add(Arc::clone(&gpu));
        scheduler.add_system(
            Schedule::Default,
            move |mut renderer: ResMut<Renderer>, scene: Res<Scene>, mut assets: ResMut<Assets>| {
                renderer
                    .execute(&scene, &mut assets)
                    .expect("execute renderer");
            },
        );

        // events.subscribe::<GuiEvent>(move |layer, event| {
        // renderer.gui.on_window_event(&event.event);
        // Ok(())
        // });
    }
}
