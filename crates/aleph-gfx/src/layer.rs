use {
    crate::renderer::{Renderer, RendererConfig},
    aleph_core::{
        events::EventSubscriber,
        layer::Layer,
        system::{Res, Resources, Schedule, Scheduler},
        Window,
    },
    aleph_scene::{assets::Assets, Scene},
    aleph_vk::Gpu,
    std::sync::Arc,
};

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
        let mut renderer = match Renderer::new(Arc::clone(&gpu), self.config.clone()) {
            Ok(renderer) => renderer,
            Err(err) => panic!("Fatal error creating renderer: {err:?}"),
        };
        let assets = Assets::new(Arc::clone(&gpu)).expect("assets");
        resources.add(assets);
        resources.add(Arc::clone(&gpu));
        scheduler.add_system(
            Schedule::Default,
            move |scene: Res<Scene>, assets: Res<Assets>| {
                renderer.execute(&scene, &assets).expect("execute renderer");
            },
        );

        // events.subscribe::<GuiEvent>(move |layer, event| {
        // renderer.gui.on_window_event(&event.event);
        // Ok(())
        // });
    }
}
