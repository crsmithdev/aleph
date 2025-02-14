use {
    crate::{
        camera::{Camera, CameraConfig},
        mesh::{Mesh, MeshData, Vertex},
        mesh_pipeline::MeshPipeline,
        vk::{
            BufferDesc, BufferUsageFlags, CommandBuffer, Extent2D, Extent3D, Format, Frame, Gpu,
            Image, ImageAspectFlags, ImageInfo, ImageLayout, ImageUsageFlags, 
            SharedBuffer,
        },
    },
    anyhow::Result,
    bytemuck::{Pod, Zeroable},
    glam::{vec3, vec4, Mat4, Vec3, Vec4},
    std::mem,
};

pub struct Material {
    pub texture: Image,
}

pub struct RenderObject {
    pub label: &'static str,
    pub model_matrix: Mat4,
    pub model_buffer: SharedBuffer,
    mesh: Mesh,
}

impl RenderObject {
    pub fn bind_mesh_buffers(&self, cmd: &CommandBuffer) {
        cmd.bind_vertex_buffer(&self.mesh.vertex_buffer, 0);
        cmd.bind_index_buffer(&self.mesh.index_buffer, 0);
    }

    fn update_model_buffer(&self, camera: &Camera) {
        let model_data = GpuModelData {
            u_model_matrix: self.model_matrix,
            u_mvp_matrix: camera.model_view_projection_matrix(self.model_matrix),
        };

        self.model_buffer.write(&[model_data]);
    }

    pub fn draw(&self, cmd: &CommandBuffer) {
        cmd.draw_indexed(self.mesh.vertex_count, 1, 0, 0, 0);
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
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuGlobalData {
    view: Mat4,
    projection: Mat4,
    view_projection: Mat4,
    ambient_color: Vec4,
    sunlight_direction: Vec4,
    sunlight_color: Vec4,
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuModelData {
    pub u_model_matrix: Mat4,
    pub u_mvp_matrix: Mat4,
}

#[derive(Clone)]
pub struct RenderContext<'a> {
    pub gpu: &'a Gpu,
    pub objects: &'a [RenderObject],
    pub camera: &'a Camera,
    pub command_buffer: &'a CommandBuffer,
    pub draw_image: &'a Image,
    pub depth_image: &'a Image,
    pub extent: Extent2D,
    pub global_buffer: &'a SharedBuffer,
    pub config: &'a RenderConfig,
}
pub trait Pipeline {
    fn execute(&self, context: &RenderContext) -> Result<()>;
}

pub(crate) const FORMAT_DRAW_IMAGE: Format = Format::R16G16B16A16_SFLOAT;
pub(crate) const FORMAT_DEPTH_IMAGE: Format = Format::D32_SFLOAT;

pub struct RenderGraph {
    frames: Vec<Frame>,
    temp_pipeline: MeshPipeline,
    global_data_buffer: SharedBuffer,
    rebuild_swapchain: bool,
    frame_index: usize,
    objects: Vec<RenderObject>,
    draw_image: Image,
    camera: Camera,
    depth_image: Image,
    config: RenderConfig,
    gpu: Gpu,
}

impl RenderGraph {
    pub fn new(gpu: Gpu) -> Result<Self> {
        let config = RenderConfig::default();
        let frames = Self::create_frames(&gpu)?;
        let global_buffer = gpu.create_shared_buffer::<GpuGlobalData>(
            BufferDesc::default()
                .size(mem::size_of::<GpuGlobalData>() as u64)
                .flags(BufferUsageFlags::TRANSFER_DST | BufferUsageFlags::UNIFORM_BUFFER)
                .label("global uniform"),
        )?;
        let draw_image = gpu.create_image(ImageInfo {
            label: Some("draw"),
            extent: gpu.swapchain().info.extent,
            format: FORMAT_DRAW_IMAGE,
            usage: ImageUsageFlags::COLOR_ATTACHMENT
                | ImageUsageFlags::TRANSFER_DST
                | ImageUsageFlags::TRANSFER_SRC
                | ImageUsageFlags::STORAGE,
            aspect_flags: ImageAspectFlags::COLOR,
        })?;
        let depth_image = gpu.create_image(ImageInfo {
            label: Some("depth"),
            extent: gpu.swapchain().info.extent,
            format: FORMAT_DEPTH_IMAGE,
            usage: ImageUsageFlags::DEPTH_STENCIL_ATTACHMENT,
            aspect_flags: ImageAspectFlags::DEPTH,
        })?;
        let camera = Camera::new(config.camera, gpu.swapchain().info.extent);

        // TODO make configurable
        let temp_texture = create_temp_texture(&gpu)?;
        let temp_object = create_temp_object(&gpu)?;
        let temp_pipeline = MeshPipeline::new(&gpu, temp_texture)?;

        Ok(Self {
            gpu,
            frames,
            temp_pipeline,
            camera,
            draw_image,
            depth_image,
            global_data_buffer: global_buffer,
            rebuild_swapchain: false,
            frame_index: 0,
            objects: vec![temp_object],
            config,
        })
    }

    pub fn context(&self) -> RenderContext {
        RenderContext {
            gpu: &self.gpu,
            objects: &self.objects,
            camera: &self.camera,
            command_buffer: &self.frames[self.frame_index].command_buffer,
            draw_image: &self.draw_image,
            depth_image: &self.depth_image,
            extent: self.gpu.swapchain().info.extent,
            global_buffer: &self.global_data_buffer,
            config: &self.config,
        }
    }

    fn check_rebuild_swapchain(&mut self) -> Result<bool> {
        match self.rebuild_swapchain {
            true => {
                self.gpu.rebuild_swapchain()?;
                self.frames = Self::create_frames(&self.gpu)?;
                self.rebuild_swapchain = false;
                Ok(true)
            }
            false => Ok(false),
        }
    }

    pub fn execute(&mut self) -> Result<()> {
        if self.check_rebuild_swapchain()? {
            return Ok(());
        }
        let Frame {
            swapchain_semaphore,
            command_buffer,
            render_semaphore,
            fence,
            ..
        } = &self.frames[self.frame_index];

        self.gpu.wait_for_fence(*fence)?;
        let (image_index, rebuild) = {
            let (image_index, rebuild) = self
                .gpu
                .swapchain
                .acquire_next_image(*swapchain_semaphore)?;
            (image_index as usize, rebuild)
        };

        self.rebuild_swapchain = rebuild;
        self.gpu.reset_fence(*fence)?;

        let cmd_buffer = &command_buffer;
        cmd_buffer.reset()?;
        cmd_buffer.begin()?;
        let swapchain_extent = self.gpu.swapchain.info.extent;
        let swapchain_image = &self.gpu.swapchain.images()[image_index];
        let draw_extent = {
            let extent = self.draw_image.info.extent;
            Extent3D {
                width: extent.width.min(swapchain_extent.width),
                height: extent.height.min(swapchain_extent.height),
                depth: 1,
            }
        };

        cmd_buffer.transition_image(
            &self.depth_image,
            ImageLayout::UNDEFINED,
            ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
        );

        cmd_buffer.transition_image(
            &self.draw_image,
            ImageLayout::UNDEFINED,
            ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
        );
        let context = self.context();
        self.update_buffers();
        self.temp_pipeline.execute(&context)?;

        cmd_buffer.transition_image(
            &self.draw_image,
            ImageLayout::UNDEFINED,
            ImageLayout::TRANSFER_SRC_OPTIMAL,
        );
        cmd_buffer.transition_image(
            swapchain_image,
            ImageLayout::UNDEFINED,
            ImageLayout::TRANSFER_DST_OPTIMAL,
        );
        cmd_buffer.copy_image(
            &self.draw_image,
            swapchain_image,
            draw_extent,
            swapchain_extent.into(),
        );
        cmd_buffer.transition_image(
            swapchain_image,
            ImageLayout::TRANSFER_DST_OPTIMAL,
            ImageLayout::PRESENT_SRC_KHR,
        );

        cmd_buffer.end()?;
        cmd_buffer.submit_queued(
            *swapchain_semaphore,
            *render_semaphore,
            *fence,
        )?;
        let rebuild = self
            .gpu
            .swapchain
            .present(&[*render_semaphore], &[image_index as u32])?;

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
    fn update_buffers(&self) {
        let camera = &self.camera;
        let data = GpuGlobalData {
            view: camera.view_matrix,
            projection: camera.perspective_matrix,
            view_projection: camera.view_projection_matrix(),
            ambient_color: vec4(0.1, 0.1, 0.1, 1.0),
            sunlight_direction: vec4(1.0, 1.0, 1.0, 0.0),
            sunlight_color: vec4(1.0, 1.0, 1.0, 1.0),
        };

        let bytes = bytemuck::bytes_of(&data);
        self.global_data_buffer.write(bytes);

        for object in &self.objects {
            object.update_model_buffer(camera);
        }
    }
}

pub fn create_temp_object(gpu: &Gpu) -> Result<RenderObject> {
    let data: &MeshData = &crate::mesh::load_mesh_data("assets/basicmesh.glb")?[2];
    let vertex_buffer_size = mem::size_of::<Vertex>() as u64 * data.vertices.len() as u64;
    let index_buffer_size = mem::size_of::<u32>() as u64 * data.indices.len() as u64;

    let vertex_buffer = gpu.create_device_buffer::<Vertex>(
        BufferDesc::default()
            .size(vertex_buffer_size)
            .flags(BufferUsageFlags::VERTEX_BUFFER | BufferUsageFlags::TRANSFER_DST)
            .label("vertex buffer"),
    )?;
    let vertex_staging = gpu.create_host_buffer(
        BufferDesc::default()
            .data(&data.vertices)
            .flags(BufferUsageFlags::TRANSFER_SRC),
    )?;

    let index_buffer = gpu.create_device_buffer::<u32>(
        BufferDesc::default()
            .size(index_buffer_size)
            .flags(BufferUsageFlags::INDEX_BUFFER | BufferUsageFlags::TRANSFER_DST)
            .label("index buffer"),
    )?;
    let index_staging = gpu.create_host_buffer(
        BufferDesc::default()
            .data(&data.indices)
            .flags(BufferUsageFlags::TRANSFER_SRC),
    )?;

    gpu.execute(|cmd| {
        cmd.copy_buffer(&vertex_staging, &vertex_buffer, vertex_buffer.size());
        cmd.copy_buffer(&index_staging, &index_buffer, index_buffer.size());
    })?;

    let model_buffer = gpu.create_shared_buffer::<GpuModelData>(
        BufferDesc::default()
            .size(mem::size_of::<GpuModelData>() as u64)
            .flags(BufferUsageFlags::UNIFORM_BUFFER | BufferUsageFlags::TRANSFER_DST)
            .label("model buffer"),
    )?;
    let vertex_count = data.indices.len() as u32;
    let mesh = Mesh {
        vertex_buffer,
        index_buffer,
        vertex_count,
    };
    Ok(RenderObject {
        label: "test object",
        model_matrix: Mat4::IDENTITY,
        model_buffer,
        mesh,
    })
}

fn create_temp_texture(gpu: &Gpu) -> Result<Image> {
    let black = 0;
    let magenta = 4294902015;

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
    let data: Vec<u8> = pixels.into_iter().flat_map(|i| i.to_le_bytes()).collect();
    let image = gpu.create_image(ImageInfo {
        label: Some("color image"),
        extent: Extent2D {
            width: 16,
            height: 16,
        },
        format: Format::R8G8B8A8_UNORM,
        usage: ImageUsageFlags::SAMPLED,
        aspect_flags: ImageAspectFlags::COLOR,
    })?;
    gpu.execute(|cmd| cmd.upload_image(&image, gpu.allocator().clone(), &data).unwrap())?;

    Ok(image)
}
