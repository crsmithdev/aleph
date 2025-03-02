use {
    crate::{
        graph::{config::RenderConfig, managers::ObjectManager, mesh::{self, GltfAsset, Scene}, ResourceManager},
        vk::Gpu,
        RenderGraph,
    }, aleph_core::{
        app::TickEvent,
        layer::{Layer, Window},
    }, anyhow::Result, glam::vec4, std::sync::{Arc, OnceLock}
};

#[derive(Default)]
pub struct GraphicsLayer {
    renderer: OnceLock<RenderGraph>,
    object_manager: ObjectManager,
    resource_manager: ResourceManager,
    gltf: Option<GltfAsset>,
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
        let config = RenderConfig::default();
        self.load_temp_data(&gpu)?;
        let mut gltf = mesh::load_gltf("assets/gltf/suzanne/Suzanne.gltf", &gpu, &mut self.resource_manager)?;
        let scene = gltf.scenes.pop().ok_or_else(|| anyhow::anyhow!("No scene found"))?;
        let graph = RenderGraph::new(gpu, config)?;

        self.renderer
            .set(graph)
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

    fn load_temp_data(&mut self, gpu: &Gpu) -> Result<()> {
        // let mut meshes = crate::graph::mesh::load_mesh_data("assets/gltf/suzanne/Suzanne.gltf")?;
        // let mesh = meshes
        //     .pop()
        //     .ok_or_else(|| anyhow::anyhow!("No mesh found"))?;
        // self.object_manager.add_mesh(gpu, mesh)?;


        self.resource_manager.load_texture(gpu, "assets/materials/rusted_iron/albedo.png", "albedo")?;
        self.resource_manager.load_texture(gpu, "assets/materials/rusted_iron/normal.png", "normal")?;
        self.resource_manager.load_texture(gpu, "assets/materials/rusted_iron/metallic.png", "metallic")?;
        self.resource_manager.load_texture(gpu, "assets/materials/rusted_iron/roughness.png", "roughness")?;
        self.resource_manager.load_texture(gpu, "assets/materials/rusted_iron/ao.png", "ao")?;
        self.resource_manager.create_single_color_image(gpu, vec4(1.0, 1.0, 1.0, 1.0), "white")?;
        self.resource_manager.create_single_color_image(gpu, vec4(0.0, 0.0, 0.0, 1.0), "black")?;
        self.resource_manager.create_single_color_image(gpu, vec4(0.5, 0.5, 0.5, 1.0), "grey")?;
        self.resource_manager.create_error_texture(gpu)?;

        Ok(())
    }
}

// fn create_temp_texture(gpu: &Gpu) -> Result<Image> {
//     let black = 0;
//     let magenta = 4294902015;

//     let pixels = {
//         let mut pixels = vec![0u32; 16 * 16];
//         for x in 0..16 {
//             for y in 0..16 {
//                 let offset = x + y * 16;
//                 pixels[offset] = match (x + y) % 2 {
//                     0 => black,
//                     _ => magenta,
//                 };
//             }
//         }
//         pixels
//     };
//     let data: Vec<u8> = pixels.into_iter().flat_map(|i| i.to_le_bytes()).collect();
//     let image = gpu.create_image(ImageInfo {
//         label: Some("color image"),
//         extent: Extent2D {
//             width: 16,
//             height: 16,
//         },
//         format: Format::R8G8B8A8_UNORM,
//         usage: ImageUsageFlags::SAMPLED,
//         aspect_flags: ImageAspectFlags::COLOR,
//     })?;
//     let staging = gpu.create_host_buffer(
//         BufferDesc::default()
//             .data(&data)
//             .flags(BufferUsageFlags::TRANSFER_SRC),
//     )?;
//     staging.write(&data);
//     gpu.execute(|cmd| cmd.copy_buffer_to_image(&staging, &image))?;

//     Ok(image)
// }
