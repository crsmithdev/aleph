use {
    crate::{gui::Gui, DebugPipeline, ForwardPipeline, Pipeline},
    aleph_scene::{
        assets::Assets,
        model::{GpuSceneData, Light},
        Scene,
    },
    aleph_vk::{
        AllocatedTexture, Buffer, BufferUsageFlags, CommandBuffer, Extent2D, Extent3D, Format,
        Frame, Gpu, ImageAspectFlags, ImageLayout, ImageUsageFlags, Texture,
    },
    anyhow::Result,
    glam::{vec3, vec4, Vec3},
    std::{mem, sync::Arc},
};

// #[derive(Clone)]
pub struct RenderContext<'a> {
    pub gpu: &'a Gpu,
    pub scene: &'a Scene,
    pub cmd_buffer: &'a CommandBuffer,
    pub scene_buffer: &'a Buffer<GpuSceneData>,
    pub draw_image: &'a AllocatedTexture,
    pub depth_image: &'a AllocatedTexture,
    pub assets: &'a mut Assets,
    pub extent: Extent2D,
}

pub(crate) const FORMAT_DRAW_IMAGE: Format = Format::R16G16B16A16_SFLOAT;
pub(crate) const FORMAT_DEPTH_IMAGE: Format = Format::D32_SFLOAT;
const LIGHTS: [Light; 4] = [
    Light {
        position: vec3(2., 2., 2.),
        color: vec4(20., 20., 20., 20.),
        radius: 10.,
    },
    Light {
        position: vec3(-2., -2., -2.),
        color: vec4(20., 20., 20., 20.),
        radius: 10.,
    },
    Light {
        position: vec3(-2., 2., 2.),
        color: vec4(20., 20., 20., 20.),
        radius: 10.,
    },
    Light {
        position: vec3(2., -2., -2.),
        color: vec4(20., 20., 20., 20.),
        radius: 10.,
    },
];

#[derive(Clone, Default)]
pub struct RendererConfig {
    pub clear_color: Vec3,
    pub auto_rotate: bool,
    pub debug_normals: bool,
}

pub struct Renderer {
    frames: Vec<Frame>,
    foreward_pipeline: ForwardPipeline,
    rebuild_swapchain: bool,
    frame_index: usize,
    frame_counter: usize,
    draw_image: AllocatedTexture,
    #[allow(dead_code)]
    debug_pipeline: DebugPipeline,
    depth_image: AllocatedTexture,
    #[allow(dead_code)]
    config: RendererConfig,
    scene_buffer: Buffer<GpuSceneData>,
    scene_data: GpuSceneData,
    pub gui: Gui,
    pub gpu: Arc<Gpu>,
}

impl Renderer {
    pub fn new(gpu: Arc<Gpu>, config: RendererConfig) -> Result<Self> {
        let frames = Self::create_frames(&gpu)?;
        let draw_image = gpu.create_texture(
            gpu.swapchain().extent(),
            FORMAT_DRAW_IMAGE,
            ImageUsageFlags::COLOR_ATTACHMENT
                | ImageUsageFlags::TRANSFER_DST
                | ImageUsageFlags::TRANSFER_SRC
                | ImageUsageFlags::STORAGE,
            ImageAspectFlags::COLOR,
            "renderer-draw",
            None,
        )?;

        let depth_image = gpu.create_texture(
            gpu.swapchain().extent(),
            FORMAT_DEPTH_IMAGE,
            ImageUsageFlags::DEPTH_STENCIL_ATTACHMENT,
            ImageAspectFlags::DEPTH,
            "renderer-depth",
            None,
        )?;

        let scene_buffer = gpu.create_shared_buffer::<GpuSceneData>(
            mem::size_of::<GpuSceneData>() as u64,
            BufferUsageFlags::TRANSFER_DST | BufferUsageFlags::UNIFORM_BUFFER,
            "renderer-scene",
        )?;

        let foreward_pipeline = ForwardPipeline::new(&gpu)?;
        let debug_pipeline = DebugPipeline::new(&gpu)?;
        let scene_data = GpuSceneData {
            lights: LIGHTS,
            n_lights: 4,
            ..Default::default()
        };

        let gui = Gui::new(&gpu, gpu.window())?;

        Ok(Self {
            gpu,
            gui,
            frames,
            foreward_pipeline,
            draw_image,
            depth_image,
            scene_data,
            rebuild_swapchain: false,
            scene_buffer,
            debug_pipeline,
            frame_index: 0,
            frame_counter: 0,
            config,
        })
    }
    fn update_scene_buffer(&mut self, scene: &Scene) {
        let view = scene.camera.view();
        let projection = scene.camera.projection();

        self.scene_data.view = view;
        self.scene_data.projection = projection;
        self.scene_data.vp = projection * view;
        self.scene_data.camera_pos = scene.camera.position();

        self.scene_buffer.write(&[self.scene_data]);
    }

    pub fn execute(&mut self, scene: &Scene, assets: &mut Assets) -> Result<()> {
        self.update_scene_buffer(scene);

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
                .swapchain()
                .acquire_next_image(*swapchain_semaphore)?;
            (image_index as usize, rebuild)
        };

        self.rebuild_swapchain = rebuild;
        self.gpu.reset_fence(*fence)?;

        let cmd_buffer = &command_buffer;
        cmd_buffer.reset()?;
        cmd_buffer.begin()?;
        let swapchain_extent = self.gpu.swapchain().extent();
        let swapchain_image = &self.gpu.swapchain().images()[image_index];
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
            assets,
            cmd_buffer: &self.frames[self.frame_index].command_buffer,
            scene_buffer: &self.scene_buffer,
            draw_image: &self.draw_image,
            depth_image: &self.depth_image,
            extent: self.gpu.swapchain().extent(),
        };
        self.foreward_pipeline.execute(&context)?;
        // if self.config.debug_normals {
        //     self.debug_pipeline.execute(&context)?;
        // }

        // self.gui
        //     .draw(&context, &mut self.config, &mut self.scene_data)?;

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
            .swapchain()
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
    fn drop(&mut self) { unsafe { self.gpu.device().handle().device_wait_idle().unwrap() }; }
}
