
use {
    crate::scene::model::Scene,
    crate::{render::PbrPipeline, scene::{camera::CameraConfig, model::GpuSceneData }, vk::{
        pipeline::Pipeline, Buffer, BufferUsageFlags, CommandBuffer, Extent2D, Extent3D, Format,
        Frame, Gpu, ImageAspectFlags, ImageLayout, ImageUsageFlags, Texture,
    }, AssetCache, Camera},
    anyhow::Result,
    bytemuck::{Pod, Zeroable},
    core::f32,
    derive_more::derive::Debug,
    glam::{vec3, vec4, Mat3, Mat4, Vec3, Vec4},
    std::mem,
};

#[derive(Clone)]
pub struct RenderContext<'a> {
    pub gpu: &'a Gpu,
    pub scene: &'a Scene,
    pub assets: &'a AssetCache,
    pub camera: &'a Camera,
    pub cmd_buffer: &'a CommandBuffer,
    pub draw_image: &'a Texture,
    pub depth_image: &'a Texture,
    pub extent: Extent2D,
    pub global_buffer: &'a Buffer<GpuSceneData>,
    pub config: &'a RendererConfig,
}

pub(crate) const FORMAT_DRAW_IMAGE: Format = Format::R16G16B16A16_SFLOAT;
pub(crate) const FORMAT_DEPTH_IMAGE: Format = Format::D32_SFLOAT;

pub struct RendererConfig {
    pub clear_color: Vec3,
    pub clear_normal: Vec4,
    pub clear_depth: f32,
    pub clear_stencil: u32,
    pub camera: CameraConfig,
}

impl Default for RendererConfig {
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


pub struct Renderer {
    frames: Vec<Frame>,
    temp_pipeline: PbrPipeline,
    global_data_buffer: Buffer<GpuSceneData>,
    rebuild_swapchain: bool,
    frame_index: usize,
    draw_image: Texture,
    camera: Camera,
    depth_image: Texture,
    config: RendererConfig,
    gpu: Gpu,
}

impl Renderer {
    pub fn new(gpu: Gpu, config: RendererConfig) -> Result<Self> {
        let frames = Self::create_frames(&gpu)?;
        let global_buffer = gpu.create_shared_buffer::<GpuSceneData>(
            mem::size_of::<GpuSceneData>() as u64,
            BufferUsageFlags::TRANSFER_DST | BufferUsageFlags::UNIFORM_BUFFER,
            "global uniform",
        )?;
        let draw_image = gpu.create_image(
            gpu.swapchain().info.extent,
            FORMAT_DRAW_IMAGE,
            ImageUsageFlags::COLOR_ATTACHMENT
                | ImageUsageFlags::TRANSFER_DST
                | ImageUsageFlags::TRANSFER_SRC
                | ImageUsageFlags::STORAGE,
            ImageAspectFlags::COLOR,
            "draw",
        )?;

        let depth_image = gpu.create_image(
            gpu.swapchain().info.extent,
            FORMAT_DEPTH_IMAGE,
            ImageUsageFlags::DEPTH_STENCIL_ATTACHMENT,
            ImageAspectFlags::DEPTH,
            "draw",
        )?;

        let camera = Camera::new(config.camera, gpu.swapchain().info.extent);
        let temp_pipeline = PbrPipeline::new(&gpu)?;

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
            config,
        })
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

    pub fn execute(&mut self, scene: &Scene, resources: &AssetCache) -> Result<()> {
        self.camera.rotate(0.01);

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
            let extent = self.draw_image.extent();
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
        let context = RenderContext {
            gpu: &self.gpu,
            scene,
            camera: &self.camera,
            assets: resources,
            cmd_buffer: &self.frames[self.frame_index].command_buffer,
            draw_image: &self.draw_image,
            depth_image: &self.depth_image,
            extent: self.gpu.swapchain().info.extent,
            global_buffer: &self.global_data_buffer,
            config: &self.config,
        };
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
        cmd_buffer.submit_queued(*swapchain_semaphore, *render_semaphore, *fence)?;
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
        let p = 15.;
        let lights = [
            vec3(-p, -p * 0.5, -p),
            vec3(-p, -p * 0.5, p),
            vec3(p, -p * 0.5, p),
            vec3(p, -p * 0.5, -p),
        ];
        let camera = &self.camera;
        let data = GpuSceneData {
            view: camera.view(),
            projection: camera.projection(),
            view_projection: camera.view_projection(),
            lights,
            camera_position: camera.position(),
            _padding1: Vec4::ZERO,
            _padding2: 0.0,
        };

        self.global_data_buffer.write(&[data]);

        // for object in context.objects.iter() {
        //     object.update_model_buffer(camera);
        // }
    }
}

impl Drop for Renderer {
    fn drop(&mut self) {
        unsafe { self.gpu.device().handle().device_wait_idle().unwrap() };
        self.global_data_buffer.destroy();
        // mem::drop(&self.draw_image);
        // mem::drop(&self.depth_image);
    }
}