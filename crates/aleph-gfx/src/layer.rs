use {
    crate::{
        graph::{ObjectManager, RenderConfig},
        mesh::{Mesh, MeshData, Vertex},
        vk::{
            BufferDesc, BufferUsageFlags, Extent2D, Format, Gpu, Image, ImageAspectFlags,
            ImageInfo, ImageUsageFlags,
        },
        GpuDrawData, RenderGraph, RenderObject,
    }, aleph_core::{
        app::TickEvent,
        layer::{Layer, Window},
    }, anyhow::Result, glam::Mat4, std::{
        mem,
        sync::{Arc, OnceLock},
    }
};

#[derive(Default)]
pub struct GraphicsLayer {
    renderer: OnceLock<RenderGraph>,
    object_manager: ObjectManager,
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
        let graph = RenderGraph::new(gpu, config)?;



        self.renderer
            .set(graph)
            .map_err(|_| anyhow::anyhow!("Failed to set renderer"))?;

        events.subscribe::<TickEvent>(move|layer, _event| layer.render());

        Ok(())
    }
}

impl GraphicsLayer {
    pub fn render(&mut self) -> Result<()> {
        self.renderer
            .get_mut()
            .expect("Renderer not initialized")
            .execute(&self.object_manager)
    }

    fn load_temp_data(&mut self, gpu: &Gpu) -> Result<()> {
        let mut meshes = crate::mesh::load_mesh_data("assets/suzanne.glb")?;
        let mesh = meshes.pop().ok_or_else(|| anyhow::anyhow!("No mesh found"))?; 
        self.object_manager.add_mesh(gpu, mesh)?;

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
