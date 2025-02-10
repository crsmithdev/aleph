use {
    crate::{
        camera::{Camera, CameraConfig},
        mesh::Vertex,
        mesh_pipeline::MeshPipeline,
        vk::{
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
    }, anyhow::Result, bytemuck::{Pod, Zeroable}, glam::{vec3, vec4, Mat4, Vec2, Vec3, Vec4}, serde::Serialize
};

pub struct Material {
    pub texture: Image,
}

pub struct RenderObject {
    pub label: &'static str,
    pub model_matrix: Mat4,
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

    fn update_model_buffer(&self, context: &RenderContext) -> Result<()> {
        let model_data = GpuModelData {
            u_model_matrix: self.model_matrix,
            u_mvp_matrix: context
                .camera
                .model_view_projection_matrix(self.model_matrix),
        };

        let bytes = bytemuck::bytes_of(&model_data);

        self.model_buffer.write(bytes);
        context
            .command_buffer
            .upload_buffer(&self.model_buffer, bytes)
    }

    pub fn draw(&self, cmd: &CommandBuffer) {
        cmd.draw_indexed(self.vertex_count, 1, 0, 0, 0);
    }
}

pub struct RenderConfig {
    pub clear_color: Vec3,
    pub clear_normal: Vec4,
    pub clear_depth: f32,
    pub clear_stencil: u32,
    pub camera: CameraConfig,
}

impl Default for RenderConfig {
    fn default() -> Self {
        Self {
            clear_color: vec3(0.0, 0.0, 0.0),
            clear_normal: vec4(0., 0., 0., 0.),
            clear_depth: 1.0,
            clear_stencil: 0,
            camera: CameraConfig::default(),
        }
    }
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable, Serialize)]
pub struct GpuGlobalData {
    view: Mat4,
    projection: Mat4,
    view_projection:Mat4,
    ambient_color: Vec4,
    sunlight_direction: Vec4,
    sunlight_color: Vec4,
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable, Serialize)]
pub struct GpuModelData {
    pub u_model_matrix: Mat4,
    pub u_mvp_matrix: Mat4,
}

pub struct RenderContext<'a> {
    pub gpu: &'a Gpu,
    pub objects: &'a [RenderObject],
    pub camera: &'a Camera,
    pub command_buffer: &'a CommandBuffer,
    pub draw_image: &'a Image,
    pub depth_image: &'a Image,
    pub extent: Extent2D,
    pub global_buffer: &'a Buffer,
    pub config: RenderConfig,
}
pub trait Pipeline {
    fn execute(&self, context: &RenderContext) -> Result<()>;
}

pub(crate) const FORMAT_DRAW_IMAGE: Format = Format::R16G16B16A16_SFLOAT;
pub(crate) const FORMAT_DEPTH_IMAGE: Format = Format::D32_SFLOAT;

pub struct RenderGraph {
    frames: Vec<Frame>,
    temp_pipeline: MeshPipeline,
    global_data_buffer: Buffer,
    rebuild_swapchain: bool,
    frame_index: usize,
    objects: Vec<RenderObject>,
    draw_image: Image,
    temp_camera: Camera,
    depth_image: Image,
    gpu: Gpu,
}

impl RenderGraph {
    pub fn new(gpu: Gpu) -> Result<Self> {
        let config = RenderConfig::default();
        let frames = vec![];

        let temp_camera = Camera::new(config.camera, gpu.swapchain().info.extent);
        let global_data_buffer = Self::create_global_data_buffer(&gpu, &temp_camera)?;
        let draw_image = Self::create_draw_image(&gpu)?;
        let depth_image = Self::create_depth_image(&gpu)?;

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
            cmd.upload_buffer(&index_buffer, &temp_mesh.indices)?;
            cmd.upload_buffer(&vertex_buffer, &temp_mesh.vertices)?;
            cmd.upload_buffer(&model_buffer, bytemuck::bytes_of(&GpuModelData::default()))?;
            cmd.upload_image(&temp_texture, &temp_texture_data)
        })?;
        let temp_object = RenderObject {
            label: "test object",
            model_matrix: Mat4::IDENTITY,
            vertex_buffer,
            model_buffer,
            vertex_count: temp_mesh.indices.len() as u32,
            index_buffer,
        };

        let temp_pipeline = MeshPipeline::new(&gpu, temp_texture)?; // &setup_command_buffer)?;

        Ok(Self {
            gpu,
            frames,
            temp_pipeline,
            temp_camera,
            draw_image,
            depth_image,
            global_data_buffer,
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
            camera: &self.temp_camera,
            command_buffer: cmd,
            draw_image: &self.draw_image,
            depth_image: &self.depth_image,
            extent: self.draw_image.info.extent,
            global_buffer: &self.global_data_buffer,
            config: RenderConfig::default(),
        };

        self.update_global_ubo(&context)?;
        self.update_model_ubos(&context);

        cmd.transition_image(
            &self.depth_image,
            ImageLayout::UNDEFINED,
            ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
        );

        cmd.transition_image(
            &self.draw_image,
            ImageLayout::UNDEFINED,
            ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
        );

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
            let mut pixels = vec![0u32; 16 * 16];
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

    fn create_global_data_buffer(gpu: &Gpu, camera: &Camera) -> Result<Buffer> {
        let buffer = gpu.create_buffer(BufferInfo {
            label: Some("global config buffer"),
            size: std::mem::size_of::<GpuGlobalData>(),
            usage: BufferUsageFlags::TRANSFER_DST | BufferUsageFlags::UNIFORM_BUFFER,
            location: MemoryLocation::CpuToGpu,
        })?;

        Ok(buffer)
    }

    fn update_global_ubo(&self, context: &RenderContext) -> Result<()> {
        let data = GpuGlobalData {
            view: context.camera.view_matrix,
            projection: context.camera.perspective_matrix,
            view_projection: context.camera.view_projection_matrix(),
            ambient_color: vec4(0.1, 0.1, 0.1, 1.0),
            sunlight_direction: vec4(1.0, 1.0, 1.0, 0.0),
            sunlight_color: vec4(1.0, 1.0, 1.0, 1.0),
        };

        let bytes = bytemuck::bytes_of(&data);
        self.global_data_buffer.write(bytes);
        context
            .command_buffer
            .upload_buffer(&self.global_data_buffer, bytes)
    }

    fn update_model_ubos(&self, context: &RenderContext) {
        for object in &self.objects {
            object.update_model_buffer(context);
        }
    }
}

type Color = Vec4;

trait ColorExt {
    fn packed(&self) -> u32;
}

impl ColorExt for Color {
    fn packed(&self) -> u32 {
        let arr = [
            (self.x.clamp(0.0, 1.0) * 255.0) as u8,
            (self.y.clamp(0.0, 1.0) * 255.0) as u8,
            (self.z.clamp(0.0, 1.0) * 255.0) as u8,
            (self.w.clamp(0.0, 1.0) * 255.0) as u8,
        ];
        u32::from_le_bytes(arr)
        // u32::from_le_bytes([v3.x as u8, v3.y as u8, v3.z as u8, v3.w as u8])
    }
}
