use {
    crate::{camera::Camera, mesh::Vertex, mesh_pipeline::MeshPipeline},
    aleph_hal::{
        Buffer,
        BufferInfo,
        BufferUsageFlags,
        CommandBuffer,
        Extent2D,
        Extent3D,
        Format,
        Frame,
        Gpu,
        Image,
        ImageAspectFlags,
        ImageInfo,
        ImageLayout,
        ImageUsageFlags,
        MemoryLocation,
    },
    anyhow::Result,
    bytemuck::{Pod, Zeroable},
    nalgebra::{Matrix4, Vector3, Vector4},
    serde::Serialize,
};

pub struct Material {
    pub texture: Image,
}

pub struct RenderObject {
    pub label: &'static str,
    pub model_matrix: Matrix4<f32>,
    pub vertex_buffer: Buffer,
    pub vertex_count: u32,
    pub index_buffer: Buffer,
    // pub material: Material,
    pub model_buffer: Buffer,
}

impl RenderObject {
    pub fn bind_mesh_buffers(&self, cmd: &CommandBuffer) {
        cmd.bind_vertex_buffer(&self.vertex_buffer, 0);
        cmd.bind_index_buffer(&self.index_buffer, 0);
    }
    fn update_model_buffer(&self, cmd: &CommandBuffer) {
        let data = GpuModelData {
            position: Vector4::new(1.0, 1.0, 1.0, 1.0), /* TODO: self.
                                                         * model_matrix: Matrix4::identity(),
                                                         * view_projection: Matrix4::identity(), */
        };
        let bytes = bytemuck::bytes_of(&data);
        self.model_buffer.write(bytes);
        cmd.upload_buffer(&self.model_buffer, bytes);
    }
    pub fn draw(&self, cmd: &CommandBuffer) {
        cmd.draw_indexed(self.vertex_count, 1, 0, 0, 0);
    }
    pub fn get_ubo(&self) -> &Buffer {
        todo!()
    }
}

pub struct RenderConfig {
    pub clear_color: Vector3<f32>,
    pub clear_normal: Vector4<u32>,
    pub clear_depth: f32,
    pub clear_stencil: u32,
}

impl Default for RenderConfig {
    fn default() -> Self {
        Self {
            clear_color: Vector3::new(0.0, 0.0, 0.0),
            clear_normal: Vector4::new(0, 0, 0, 0),
            clear_depth: 1.0,
            clear_stencil: 0,
        }
    }
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable, Serialize)]
pub struct GpuGlobalData {
    test_value: Vector4<f32>,
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable, Serialize)]
pub struct GpuModelData {
    position: Vector4<f32>,
}

pub struct RenderContext<'a> {
    pub gpu: &'a Gpu,
    pub objects: &'a [RenderObject],
    pub camera: &'a Camera,
    pub command_buffer: &'a CommandBuffer,
    pub draw_image: &'a Image,
    // pub depth_image: &'a Image,
    pub extent: Extent2D,
    pub global_buffer: &'a Buffer,
}

pub trait Pipeline {
    fn execute(&self, context: &RenderContext) -> Result<()>;
}

pub(crate) const FORMAT_DRAW_IMAGE: Format = Format::R16G16B16A16_SFLOAT;
pub(crate) const FORMAT_DEPTH_IMAGE: Format = Format::D32_SFLOAT;

pub struct RenderGraph {
    frames: Vec<Frame>,
    temp_pipeline: MeshPipeline,
    config_buffer: Buffer,
    rebuild_swapchain: bool,
    frame_index: usize,
    objects: Vec<RenderObject>,
    draw_image: Image,
    // depth_image: Image,
    gpu: Gpu,
}

impl RenderGraph {
    pub fn new(gpu: Gpu) -> Result<Self> {
        let frames = vec![];
        let config_buffer = Self::create_config_buffer(&gpu)?;
        let draw_image = Self::create_draw_image(&gpu)?;
        // let depth_image = Self::create_depth_image(&gpu)?;
        let pool = gpu.create_command_pool()?;

        let temp_mesh = &crate::mesh::load_meshes2("assets/basicmesh.glb")?[2];
        let index_buffer = gpu.create_buffer(BufferInfo {
            label: Some("index"),
            usage: BufferUsageFlags::INDEX_BUFFER | BufferUsageFlags::TRANSFER_DST,
            location: MemoryLocation::CpuToGpu,
            size: temp_mesh.indices.len() * std::mem::size_of::<GpuGlobalData>(),
        })?;
        let vertex_buffer = gpu.create_buffer(BufferInfo {
            label: Some("vertex"),
            usage: BufferUsageFlags::VERTEX_BUFFER | BufferUsageFlags::TRANSFER_DST,
            location: MemoryLocation::CpuToGpu,
            size: temp_mesh.vertices.len() * std::mem::size_of::<Vertex>(),
        })?;
        let model_buffer = gpu.create_buffer(BufferInfo {
            label: Some("global config buffer"),
            size: std::mem::size_of::<GpuModelData>(),
            usage: BufferUsageFlags::UNIFORM_BUFFER | BufferUsageFlags::TRANSFER_DST,
            location: MemoryLocation::CpuToGpu,
        })?;



        let temp_texture_data = Self::create_temp_texture_data();
        let temp_texture = gpu.create_image(ImageInfo {
            label: Some("color image"),
            extent: Extent2D {
                width: 1,
                height: 1,
            },
            format: Format::R8G8B8A8_UNORM,
            usage: ImageUsageFlags::SAMPLED,
            aspect_flags: ImageAspectFlags::COLOR,
        })?;
        gpu.with_setup_cb(|cmd| {
            cmd.upload_buffer(&index_buffer, &temp_mesh.indices);
            cmd.upload_buffer(&vertex_buffer, &temp_mesh.vertices);
            cmd.upload_buffer(&model_buffer, bytemuck::bytes_of(&GpuModelData::default()));
            cmd.upload_image(&temp_texture, &temp_texture_data);
        });
        let temp_object = RenderObject {
            label: "test object",
            model_matrix: Matrix4::identity(),
            vertex_buffer,
            vertex_count: temp_mesh.indices.len() as u32,
            index_buffer,
            model_buffer,
        };
        let temp_pipeline = MeshPipeline::new(&gpu, temp_texture)?;// &setup_command_buffer)?;

        Ok(Self {
            gpu,
            frames,
            temp_pipeline,
            draw_image,
            // depth_image,
            config_buffer,
            rebuild_swapchain: false,
            frame_index: 0,
            objects: vec![temp_object],
        })
    }

    pub fn execute(&mut self) -> Result<()> {
        if self.frames.len() == 0 {
            self.frames = Self::create_frames(&self.gpu)?;
        }
        if self.rebuild_swapchain {
            self.gpu.rebuild_swapchain()?;
            self.frames = Self::create_frames(&self.gpu)?;
            self.rebuild_swapchain = false;
            return Ok(());
        }

        let gpu = &self.gpu;

        let swapchain = &gpu.swapchain();
        let frame = &self.frames[self.frame_index];
        let fence = frame.fence;
        let cmd = &frame.command_buffer;
        let render_semaphore = &frame.render_semaphore;
        let swapchain_semaphore = &frame.swapchain_semaphore;

        gpu.wait_for_fence(fence)?;
        let (image_index, rebuild) = {
            let (image_index, rebuild) = swapchain.acquire_next_image(*swapchain_semaphore)?;
            (image_index as usize, rebuild)
        };

        self.rebuild_swapchain = rebuild;
        gpu.reset_fence(fence)?;
        cmd.reset()?;
        cmd.begin()?;

        self.update_config_buffer(cmd);
        self.update_model_buffers(cmd);

        let swapchain_extent = swapchain.info.extent;
        let swapchain_image = &swapchain.images()[image_index];
        let draw_extent = {
            let extent = self.draw_image.info.extent;
            Extent3D {
                width: extent.width.min(swapchain_extent.width),
                height: extent.height.min(swapchain_extent.height),
                depth: 1,
            }
        };
        let context = RenderContext {
            gpu,
            objects: &self.objects,
            camera: &Camera::default(),
            command_buffer: cmd,
            draw_image: &self.draw_image,
            // depth_image: &self.depth_image,
            extent: self.draw_image.info.extent,
            global_buffer: &self.config_buffer,
        };

        // cmd.transition_image(
        //     &self.depth_image,
        //     ImageLayout::UNDEFINED,
        //     ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
        // );

        // cmd.transition_image(
        // &self.draw_image,
        // ImageLayout::UNDEFINED,
        // ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
        // );

        self.temp_pipeline.execute(&context)?;

        cmd.transition_image(
            &self.draw_image,
            ImageLayout::UNDEFINED,
            ImageLayout::TRANSFER_SRC_OPTIMAL,
        );
        cmd.transition_image(
            swapchain_image,
            ImageLayout::UNDEFINED,
            ImageLayout::TRANSFER_DST_OPTIMAL,
        );
        cmd.copy_image(
            &self.draw_image,
            swapchain_image,
            draw_extent,
            swapchain_extent.into(),
        );
        cmd.transition_image(
            swapchain_image,
            ImageLayout::TRANSFER_DST_OPTIMAL,
            ImageLayout::PRESENT_SRC_KHR,
        );

        cmd.end()?;
        cmd.submit_queued(&frame.swapchain_semaphore, &frame.render_semaphore, fence)?;
        let rebuild = swapchain.present(&[*render_semaphore], &[image_index as u32])?;

        self.rebuild_swapchain |= rebuild;
        self.frame_index = image_index;

        Ok(())
    }

    fn create_frames(gpu: &Gpu) -> Result<Vec<Frame>> {
        (0..gpu.swapchain().in_flight_frames())
            .map(|_| {
                let pool = gpu.create_command_pool()?;
                let command_buffer = pool.create_command_buffer()?;

                Ok(Frame {
                    swapchain_semaphore: gpu.create_semaphore()?,
                    render_semaphore: gpu.create_semaphore()?,
                    fence: gpu.create_fence_signaled()?,
                    command_pool: pool,
                    command_buffer,
                })
            })
            .collect()
    }

    fn create_draw_image(gpu: &Gpu) -> Result<Image> {
        let extent = gpu.swapchain().info.extent;
        gpu.create_image(ImageInfo {
            label: Some("draw image"),
            extent,
            format: FORMAT_DRAW_IMAGE,
            usage: ImageUsageFlags::COLOR_ATTACHMENT
                | ImageUsageFlags::TRANSFER_DST
                | ImageUsageFlags::TRANSFER_SRC
                | ImageUsageFlags::STORAGE,
            aspect_flags: ImageAspectFlags::COLOR,
        })
    }

    fn create_depth_image(gpu: &Gpu) -> Result<Image> {
        gpu.create_image(ImageInfo {
            label: Some("depth image"),
            extent: gpu.swapchain().info.extent,
            format: FORMAT_DEPTH_IMAGE,
            usage: ImageUsageFlags::DEPTH_STENCIL_ATTACHMENT,
            aspect_flags: ImageAspectFlags::DEPTH,
        })
    }
    
    fn create_temp_texture_data() -> Vec<u8> {
        let black = Color::new(0.0, 0.0, 0.0, 0.0).packed();
        let magenta = Color::new(1.0, 0.0, 1.0, 1.0).packed();

        let pixels = {
            let mut pixels = vec![0u32; 1 * 1];
            for x in 0..16 {
                for y in 0..16 {
                    let offset = x + y * 16;
                    pixels[offset] = match (x + y) % 2 {
                        0 => black,
                        _ => magenta,
                    };
                }
            }
            pixels
        };
        pixels.into_iter().flat_map(|i| i.to_le_bytes()).collect()
    }

    fn create_config_buffer(gpu: &Gpu) -> Result<Buffer> {
        let buffer = gpu.create_buffer(BufferInfo {
            label: Some("global config buffer"),
            size: std::mem::size_of::<GpuGlobalData>(),
            usage: BufferUsageFlags::TRANSFER_DST | BufferUsageFlags::UNIFORM_BUFFER,
            location: MemoryLocation::CpuToGpu,
        })?;
        buffer.write(bytemuck::bytes_of(&GpuGlobalData {
            test_value: Vector4::new(1.0, 0.0, 1.0, 1.0),
        }));
        Ok(buffer)
    }

    fn update_config_buffer(&self, cmd: &CommandBuffer) {
        let data = GpuGlobalData {
            test_value: Vector4::new(1.0, 0.0, 1.0, 1.0),
        };
        let bytes = bytemuck::bytes_of(&data);
        self.config_buffer.write(bytes);
        cmd.upload_buffer(&self.config_buffer, bytes);
    }

    fn update_model_buffers(&self, cmd: &CommandBuffer) {
        for object in &self.objects {
            object.update_model_buffer(cmd);
        }
    }

    /*

        fn update_model_uniform_buffers(
      config: &Config,
      scene: &World,
      frame_in_flight_id: FrameInFlightId,
    ) {
      let camera = &scene.camera;
      scene.entities.iter().for_each(|entity| {
        entity.update_ubo_data(frame_in_flight_id, config, camera);
      });
    }

            fn update_config_uniform_buffer(
          vk_app: &VkCtx,
          config: &Config,
          timer: &AppTimer,
          scene: &World,
          vk_buffer: &VkBuffer,
        ) {
          let camera = &scene.camera;
          let data = GlobalConfigUBO::new(vk_app, config, timer, camera);
          let data_bytes = bytemuck::bytes_of(&data);
          vk_buffer.write_to_mapped(data_bytes);
        } */
}
type Color = Vector4<f32>;

trait ColorExt {
    fn packed(&self) -> u32;
}

impl ColorExt for Color {
    fn packed(&self) -> u32 {
        let v2 = self.iter().map(|f| (f.clamp(0.0, 1.0) * 255.0) as u32);
        let v3 = Vector4::from_iterator(v2);
        u32::from_le_bytes([v3.x as u8, v3.y as u8, v3.z as u8, v3.w as u8])
    }
}
