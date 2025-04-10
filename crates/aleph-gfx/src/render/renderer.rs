use {
    super::{debug, DebugPipeline},
    crate::{
        render::ForewardPipeline,
        scene::{camera::CameraConfig, Camera},
        vk::{
            pipeline::Pipeline, CommandBuffer, Extent2D, Extent3D, Format, Frame, Gpu,
            ImageAspectFlags, ImageLayout, ImageUsageFlags, Texture,
        },
        Scene,
    },
    aleph_core::input::InputState,
    anyhow::Result,
    core::f32,
    glam::{vec3, vec4, Vec3, Vec4},
    tracing::instrument,
    winit::{
        event::MouseButton,
        keyboard::{Key, NamedKey},
    },
};

#[derive(Clone)]
pub struct RenderContext<'a> {
    pub gpu: &'a Gpu,
    pub scene: &'a Scene,
    pub camera: &'a Camera,
    pub cmd_buffer: &'a CommandBuffer,
    pub draw_image: &'a Texture,
    pub depth_image: &'a Texture,
    pub extent: Extent2D,
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
    foreward_pipeline: ForewardPipeline,
    rebuild_swapchain: bool,
    frame_index: usize,
    frame_counter: usize,
    draw_image: Texture,
    debug_pipeline: debug::DebugPipeline,
    camera: Camera,
    depth_image: Texture,
    config: RendererConfig,
    gpu: Gpu,
}

impl Renderer {
    pub fn new(gpu: Gpu, config: RendererConfig) -> Result<Self> {
        let frames = Self::create_frames(&gpu)?;
        let draw_image = gpu.create_image(
            gpu.swapchain().extent(),
            FORMAT_DRAW_IMAGE,
            ImageUsageFlags::COLOR_ATTACHMENT
                | ImageUsageFlags::TRANSFER_DST
                | ImageUsageFlags::TRANSFER_SRC
                | ImageUsageFlags::STORAGE,
            ImageAspectFlags::COLOR,
            "draw",
            None,
        )?;

        let depth_image = gpu.create_image(
            gpu.swapchain.extent(),
            FORMAT_DEPTH_IMAGE,
            ImageUsageFlags::DEPTH_STENCIL_ATTACHMENT,
            ImageAspectFlags::DEPTH,
            "draw",
            None,
        )?;

        let camera = Camera::new(config.camera, gpu.swapchain.extent());
        let foreward_pipeline = ForewardPipeline::new(&gpu)?;
        let debug_pipeline = DebugPipeline::new(&gpu)?;

        Ok(Self {
            gpu,
            frames,
            foreward_pipeline,
            camera,
            draw_image,
            depth_image,
            rebuild_swapchain: false,
            debug_pipeline,
            frame_index: 0,
            frame_counter: 0,
            config,
        })
    }

    fn handle_input(&mut self, input: &InputState) {
        let multiplier = match input.key_pressed(&Key::Named(NamedKey::Shift)) {
            true => 1.,
            false => 0.01,
        };
        if input.mouse_held(&MouseButton::Right) {
            if let Some(delta) = input.mouse_delta() {
                self.camera.rotate(delta * multiplier);
            }
        }

        if let Some(delta) = input.mouse_scroll_delta() {
            self.camera.zoom(delta * multiplier * 10.);
        }
    }

    #[instrument(skip_all)]
    pub fn execute(&mut self, scene: &Scene, input: &InputState) -> Result<()> {
        self.handle_input(input);
        tracing::trace!("start of frame {}", self.frame_counter);

        if self.rebuild_swapchain {
            self.gpu.rebuild_swapchain()?;
            self.frames = Self::create_frames(&self.gpu)?;
            self.rebuild_swapchain = false;
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
        let swapchain_extent = self.gpu.swapchain.extent();
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
            cmd_buffer: &self.frames[self.frame_index].command_buffer,
            draw_image: &self.draw_image,
            depth_image: &self.depth_image,
            extent: self.gpu.swapchain.extent(),
            config: &self.config,
        };
        self.foreward_pipeline.execute(&context)?;
        self.debug_pipeline.execute(&context)?;

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
        self.frame_counter += 1;

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
}

impl Drop for Renderer {
    fn drop(&mut self) {
        unsafe { self.gpu.device().handle().device_wait_idle().unwrap() };
    }
}
