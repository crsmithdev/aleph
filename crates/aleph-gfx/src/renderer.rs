use {
    crate::{
        resource::{RenderObject, RendererResources},
        ForwardPipeline, Gui, Pipeline, ResourceBinder,
    },
    aleph_scene::{Assets, MaterialHandle, Scene},
    aleph_vk::{
        sync, AccessFlags2, CommandBuffer, CommandPool, Extent2D, Fence, Format, Gpu,
        Handle as VkHandle, ImageAspectFlags, ImageLayout, ImageUsageFlags, PipelineStageFlags2,
        Semaphore, Texture, TextureInfo,
    },
    anyhow::Result,
    ash::vk::FenceCreateFlags,
    bitflags::bitflags,
    derive_more::Debug,
    std::{collections::HashMap, sync::Arc},
    tracing::instrument,
};
bitflags! {
    #[derive(Clone, Copy, Debug, Default)]
    pub struct RenderFlags: u32 {
            const DEBUG_COLOR           = 0b00000000_00000000_00000001;
            const DEBUG_NORMALS         = 0b00000000_00000000_00000010;
            const DEBUG_TANGENTS        = 0b00000000_00000000_00000100;
            const DEBUG_METALLIC        = 0b00000000_00000000_00001000;
            const DEBUG_ROUGHNESS       = 0b00000000_00000000_00010000;
            const DEBUG_OCCLUSION       = 0b00000000_00000000_00100000;
            const DEBUG_TEXCOORDS0      = 0b00000000_00000000_01000000;

            const DISABLE_COLOR_MAP     = 0b00000000_00000001_00000000;
            const DISABLE_NORMAL_MAP    = 0b00000000_00000010_00000000;
            const DISABLE_MR_MAP        = 0b00000000_00000100_00000000;
            const DISABLE_OCCLUSION_MAP = 0b00000000_00001000_00000000;
            const DISABLE_TANGENTS      = 0b00000000_00010000_00000000;

            const OVERRIDE_COLOR        = 0b00000001_00000000_00000000;
            const OVERRIDE_METAL        = 0b00000010_00000000_00000000;
            const OVERRIDE_ROUGH        = 0b00000100_00000000_00000000;
            const OVERRIDE_OCCLUSION    = 0b00001000_00000000_00000000;
            const OVERRIDE_LIGHTS       = 0b00010000_00000000_00000000;

    }
}

const FORMAT_DRAW_IMAGE: Format = Format::R16G16B16A16_SFLOAT;
const FORMAT_DEPTH_IMAGE: Format = Format::D32_SFLOAT;
const N_FRAMES: usize = 2;

#[derive(Debug)]
pub struct Frame {
    #[debug("{:#x}", acquire_semaphore.as_raw())]
    pub acquire_semaphore: Semaphore,
    #[debug("{:#x}", present_semaphore.as_raw())]
    pub present_semaphore: Semaphore,
    #[allow(dead_code)]
    #[debug("{:#x}", fence.as_raw())]
    pub fence: Fence,
    #[debug("{:#x}", cmd_pool.handle().as_raw())]
    #[allow(dead_code)]
    pub cmd_pool: CommandPool,
    #[debug("{:#x}", cmd_buffer.handle().as_raw())]
    pub cmd_buffer: CommandBuffer,
}

impl Frame {
    pub fn new(gpu: &Gpu) -> Self {
        let cmd_pool = CommandPool::new(
            gpu.device(),
            gpu.device().graphics_queue(),
            &format!("frame-pool"),
        );
        let cmd_buffer = cmd_pool.create_command_buffer(&format!("frame-cmd"));

        let acquire_semaphore = gpu.device().create_semaphore();
        let present_semaphore = gpu.device().create_semaphore();
        let fence = gpu.device().create_fence(FenceCreateFlags::SIGNALED);

        Frame {
            cmd_pool,
            acquire_semaphore,
            present_semaphore,
            cmd_buffer,
            fence,
        }
    }
}

pub struct RenderContext<'a> {
    pub gpu: &'a Gpu,
    pub scene: &'a Scene,
    pub command_buffer: &'a CommandBuffer,
    pub draw_image: &'a Texture,
    pub material_map: &'a HashMap<MaterialHandle, usize>,
    pub render_extent: Extent2D,
    pub depth_image: &'a Texture,
    pub binder: &'a ResourceBinder,
    pub assets: &'a Assets,
    pub objects: &'a [RenderObject],
}

// GPU resource bundle for Renderer

// Main Renderer
#[derive(Debug)]
pub struct Renderer {
    #[debug("{}", self.frames.len())]
    frames: Vec<Frame>,
    #[debug(skip)]
    forward_pipeline: ForwardPipeline,
    rebuild_swapchain: bool,
    frame_idx: usize,
    pub extent: Extent2D,
    frame_counter: usize,
    last_scene_version: u64,

    pub draw_image: Texture,
    pub depth_image: Texture,

    resources: RendererResources,

    #[debug(skip)]
    material_map: HashMap<MaterialHandle, usize>,

    // State
    #[debug(skip)]
    pub gpu: Arc<Gpu>,
}

impl Renderer {
    pub fn new(gpu: Arc<Gpu>) -> Result<Self> {
        let extent = gpu.swapchain().extent();
        let (draw_image, depth_image) = Self::create_attachments(&gpu, extent)?;
        let frames = Self::create_frames(&gpu);
        let resources = RendererResources::new(&gpu)?;
        let forward_pipeline = ForwardPipeline::new(
            &gpu,
            &resources.binder.descriptor_layout(),
            &draw_image,
            &depth_image,
        )?;

        Ok(Self {
            gpu,
            frames,
            forward_pipeline,
            resources,
            rebuild_swapchain: false,
            frame_idx: 0,
            draw_image,
            depth_image,
            extent,
            frame_counter: 0,
            material_map: HashMap::new(),
            last_scene_version: 0,
        })
    }

    fn create_frames(gpu: &Arc<Gpu>) -> Vec<Frame> {
        (0..N_FRAMES).map(|_| Frame::new(&gpu)).collect::<Vec<Frame>>()
    }

    #[instrument(skip_all)]
    pub fn render(
        &mut self,
        scene: &Scene,
        assets: &mut Assets,
        gui: &mut Gui,
        // window_extent: Extent2D,
    ) -> Result<()> {
        self.resources.update_per_frame_data(scene, assets);

        if scene.version() > self.last_scene_version {
            self.last_scene_version = scene.version();
            self.resources.prepare_bindless(&self.gpu, assets, scene)?;
        }

        if self.rebuild_swapchain {
            let extent = self.gpu.swapchain().extent();
            self.rebuild_swapchain(extent);
        }

        let Frame {
            acquire_semaphore,
            cmd_buffer,
            present_semaphore,
            fence,
            ..
        } = &self.frames[self.frame_idx];

        self.gpu.device().wait_for_fences(&[*fence]);
        let (next_image_index, rebuild_swapchain) =
            self.gpu.swapchain().acquire_next_image(*acquire_semaphore)?;
        self.gpu.device().reset_fences(&[*fence]);
        self.rebuild_swapchain = rebuild_swapchain;
        let swapchain_image = {
            let swapchain = self.gpu.swapchain();
            &swapchain.images()[next_image_index]
        };

        cmd_buffer.reset();
        cmd_buffer.begin();
        cmd_buffer.bind_index_buffer(&self.resources.index_buffer, 0);
        cmd_buffer.bind_vertex_buffer(&self.resources.vertex_buffer, 0);

        cmd_buffer.pipeline_barrier(
            &[],
            &[],
            &[sync::image_memory_barrier(
                &self.draw_image,
                PipelineStageFlags2::TOP_OF_PIPE,
                AccessFlags2::NONE,
                PipelineStageFlags2::COLOR_ATTACHMENT_OUTPUT,
                AccessFlags2::COLOR_ATTACHMENT_WRITE,
                ImageLayout::UNDEFINED,
                ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
            )],
        );

        cmd_buffer.pipeline_barrier(
            &[],
            &[],
            &[sync::image_memory_barrier(
                &self.depth_image,
                PipelineStageFlags2::TOP_OF_PIPE,
                AccessFlags2::NONE,
                PipelineStageFlags2::EARLY_FRAGMENT_TESTS
                    | PipelineStageFlags2::LATE_FRAGMENT_TESTS,
                AccessFlags2::DEPTH_STENCIL_ATTACHMENT_READ
                    | AccessFlags2::DEPTH_STENCIL_ATTACHMENT_WRITE,
                ImageLayout::UNDEFINED,
                ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
            )],
        );

        let context = RenderContext {
            gpu: &self.gpu,
            command_buffer: &cmd_buffer,
            draw_image: &self.draw_image,
            depth_image: &self.depth_image,
            render_extent: self.extent,
            material_map: &self.material_map,
            binder: &self.resources.binder,
            scene,
            objects: &self.resources.render_objects,
            assets,
        };

        self.forward_pipeline.render(&context, &cmd_buffer)?;
        gui.draw(&context, &mut self.resources.config_data)?;

        cmd_buffer.pipeline_barrier(
            &[],
            &[],
            &[sync::image_memory_barrier(
                &self.draw_image,
                PipelineStageFlags2::COLOR_ATTACHMENT_OUTPUT,
                AccessFlags2::COLOR_ATTACHMENT_WRITE,
                PipelineStageFlags2::TRANSFER,
                AccessFlags2::TRANSFER_READ,
                ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
                ImageLayout::TRANSFER_SRC_OPTIMAL,
            )],
        );

        cmd_buffer.pipeline_barrier(
            &[],
            &[],
            &[sync::image_memory_barrier(
                &swapchain_image,
                PipelineStageFlags2::TOP_OF_PIPE,
                AccessFlags2::NONE,
                PipelineStageFlags2::TRANSFER,
                AccessFlags2::TRANSFER_WRITE,
                ImageLayout::UNDEFINED,
                ImageLayout::TRANSFER_DST_OPTIMAL,
            )],
        );

        cmd_buffer.copy_image(
            &self.draw_image,
            swapchain_image,
            self.draw_image.extent().into(),
            swapchain_image.extent().into(),
        );
        cmd_buffer.pipeline_barrier(
            &[],
            &[],
            &[sync::image_memory_barrier(
                &swapchain_image,
                PipelineStageFlags2::TRANSFER,
                AccessFlags2::TRANSFER_WRITE,
                PipelineStageFlags2::BOTTOM_OF_PIPE,
                AccessFlags2::NONE,
                ImageLayout::TRANSFER_DST_OPTIMAL,
                ImageLayout::PRESENT_SRC_KHR,
            )],
        );
        cmd_buffer.end();

        self.gpu.queue_submit(
            &self.gpu.device().graphics_queue(),
            &[cmd_buffer],
            &[(*acquire_semaphore, PipelineStageFlags2::ALL_COMMANDS)],
            &[(*present_semaphore, PipelineStageFlags2::ALL_COMMANDS)],
            *fence,
        );

        let rebuild_swapchain = self.gpu.swapchain().present(
            self.gpu.device().graphics_queue(),
            &[*present_semaphore],
            &[next_image_index as u32],
        )?;

        self.frame_counter += 1;
        self.frame_idx = self.frame_counter % self.frames.len();
        self.rebuild_swapchain |= rebuild_swapchain;

        Ok(())
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        log::debug!("Resizing renderer to {}x{}", width, height);
        let extent = Extent2D { width, height };
        self.rebuild_swapchain(extent);
    }

    pub fn rebuild_swapchain(&mut self, extent: Extent2D) {
        log::debug!("Rebuilding swapchain with extent: {:?}", extent);

        self.extent = extent;
        self.gpu.rebuild_swapchain(extent);
        self.frames = Self::create_frames(&self.gpu);
        let (draw_image, depth_image) = Self::create_attachments(&self.gpu, extent).unwrap();
        self.draw_image = draw_image;
        self.depth_image = depth_image;
        self.forward_pipeline = ForwardPipeline::new(
            &self.gpu,
            &self.resources.binder.descriptor_layout(),
            &self.draw_image,
            &self.depth_image,
        )
        .unwrap();
        self.rebuild_swapchain = false;
    }

    pub fn create_attachments(gpu: &Gpu, extent: Extent2D) -> Result<(Texture, Texture)> {
        let draw_info = TextureInfo {
            name: "draw".to_string(),
            extent,
            format: FORMAT_DRAW_IMAGE,
            flags: ImageUsageFlags::COLOR_ATTACHMENT
                | ImageUsageFlags::TRANSFER_DST
                | ImageUsageFlags::TRANSFER_SRC,
            aspect_flags: ImageAspectFlags::COLOR,
            sampler: None,
        };
        let depth_info = TextureInfo {
            name: "depth".to_string(),
            extent,
            format: FORMAT_DEPTH_IMAGE,
            flags: ImageUsageFlags::DEPTH_STENCIL_ATTACHMENT
                | ImageUsageFlags::TRANSFER_DST
                | ImageUsageFlags::TRANSFER_SRC,
            aspect_flags: ImageAspectFlags::DEPTH,
            sampler: None,
        };

        let draw_image = Texture::new(gpu, &draw_info)?;
        let depth_image = Texture::new(gpu, &depth_info)?;

        Ok((draw_image, depth_image))
    }
}
