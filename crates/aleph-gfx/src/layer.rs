use {
    crate::{
        render::renderer::{Renderer, RendererConfig},
        scene::gltf,
        vk::Gpu,
        Scene,
    },
    aleph_core::{
        app::TickEvent,
        input::InputState,
        layer::{Layer, Window},
    },
    anyhow::Result,
    std::sync::{Arc, OnceLock},
};


#[derive(Default)]
pub struct GraphicsLayer {
    renderer: OnceLock<Renderer>,
    scene: Option<Scene>,
}

impl Layer for GraphicsLayer {
    fn init(
        &mut self,
        window: Arc<Window>,
        mut events: aleph_core::events::EventSubscriber<Self>,
    ) -> anyhow::Result<()>
    where
        Self: Sized,
    {
        let gpu = Gpu::new(Arc::clone(&window))?;
        // let scene = gltf::load_validation_scene(&gpu, "Mesh_Primitives", 0)?;
        let path = gltf::sample_path("NormalTangentTest")?;
        let scene = gltf::load(&gpu, &path)?;

        // let doc = gltf2::load_validation_scene(GLTF_SCENE, 1)?;
        // let scene = Scene::from_gltf(&gpu, &doc)?;
        let config = RendererConfig::default();
        let renderer = Renderer::new(gpu, config)?;
        self.scene = Some(scene);

        self.renderer
            .set(renderer)
            .map_err(|_| anyhow::anyhow!("Failed to set renderer"))?;
        events.subscribe::<TickEvent>(move |layer, event| layer.render(&event.input));

        Ok(())
    }
}

impl GraphicsLayer {
    pub fn render(&mut self, input: &InputState) -> Result<()> {
        if let Some(scene) = &mut self.scene {
            self.renderer
                .get_mut()
                .expect("Renderer not initialized")
                .execute(&scene, input)?;
        }
        Ok(())
    }
}
