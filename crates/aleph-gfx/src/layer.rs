use {
    crate::{
        render::renderer::{Renderer, RendererConfig},
        scene::{
            gltf::{self},
            AssetCache,
            model::Scene,
        },
        vk::Gpu, Material,
    },
    aleph_core::{
        app::TickEvent,
        layer::{Layer, Window},
    },
    anyhow::Result,
    ash::vk::{Image, ImageAspectFlags, ImageUsageFlags},
    std::{
        backtrace,
        collections::HashMap,
        sync::{Arc, OnceLock},
    },
};

#[derive(Default)]
pub struct GraphicsLayer {
    renderer: OnceLock<Renderer>,
    resource_manager: AssetCache,
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
        let doc = gltf::load_gltf2("assets/gltf/suzanne/Suzanne.gltf")?;
        let scene = Scene::from_gltf(&gpu, &doc, &mut self.resource_manager)?;
        let config = RendererConfig::default();
        let renderer = Renderer::new(gpu, config)?;

        self.renderer
            .set(renderer)
            .map_err(|_| anyhow::anyhow!("Failed to set renderer"))?;

        events.subscribe::<TickEvent>(move |layer, _event| layer.render(&scene));

        Ok(())
    }
}

impl GraphicsLayer {
    pub fn render(&mut self, scene: &Scene) -> Result<()> {
        self.renderer
            .get_mut()
            .expect("Renderer not initialized")
            .execute(scene, &self.resource_manager)
    }

}
