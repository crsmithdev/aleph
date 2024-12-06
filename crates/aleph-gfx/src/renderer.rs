use {
    crate::ui::UiRenderer,
    aleph_hal::{
        vk::{
            descriptor::DescriptorAllocator,
            image::{Image, ImageInfo},
            CommandBuffer,
        },
        Context,
        Frame,
    },
    anyhow::Result,
    ash::vk::{self, Extent3D},
    std::{fmt, sync::Arc},
};

#[allow(dead_code)]
struct GraphicsRenderer {
    context: Context,
    descriptor_allocator: Arc<DescriptorAllocator>,
    draw_image: Image,
    draw_image_descriptors: vk::DescriptorSet,
    draw_image_layout: vk::DescriptorSetLayout,
    gradient_pipeline: vk::Pipeline,
    gradient_pipeline_layout: vk::PipelineLayout,
}

impl GraphicsRenderer {
    pub fn new(context: &Context) -> Result<Self> {
        let extent = context.swapchain().extent();
        let draw_image = Image::new(&ImageInfo {
            allocator: context.allocator(),
            width: extent.width as usize,
            height: extent.height as usize,
            format: vk::Format::R16G16B16A16_SFLOAT,
            usage: vk::ImageUsageFlags::COLOR_ATTACHMENT
                | vk::ImageUsageFlags::TRANSFER_DST
                | vk::ImageUsageFlags::TRANSFER_SRC
                | vk::ImageUsageFlags::STORAGE,
        })?;
        let descriptor_allocator = Arc::new(DescriptorAllocator::new(
            context.device(),
            &[vk::DescriptorPoolSize {
                ty: vk::DescriptorType::STORAGE_IMAGE,
                descriptor_count: 1,
            }],
            10,
        )?);
        log::info!("Created descriptor allocator: {:?}", &descriptor_allocator);

        let desc_bindings = &[vk::DescriptorSetLayoutBinding::default()
            .binding(0)
            .stage_flags(vk::ShaderStageFlags::COMPUTE)
            .descriptor_type(vk::DescriptorType::STORAGE_IMAGE)
            .descriptor_count(1)];
        let desc_layout = context.create_descriptor_set_layout(
            desc_bindings,
            vk::DescriptorSetLayoutCreateFlags::empty(),
        )?;

        let desc_sets = descriptor_allocator.allocate(&desc_layout)?;

        let image_info = &[vk::DescriptorImageInfo::default()
            .image_layout(vk::ImageLayout::GENERAL)
            .image_view(draw_image.view)];

        let image_write = &[vk::WriteDescriptorSet::default()
            .dst_binding(0)
            .dst_set(desc_sets)
            .descriptor_count(1)
            .descriptor_type(vk::DescriptorType::STORAGE_IMAGE)
            .image_info(image_info)];

        context.update_descriptor_sets(image_write, &[]);

        let layouts = &[desc_layout];
        let shader = context.load_shader("shaders/gradient.spv")?;

        let pipeline_layout_info = vk::PipelineLayoutCreateInfo::default().set_layouts(layouts);
        let gradient_pipeline_layout = unsafe {
            context
                .device()
                .create_pipeline_layout(&pipeline_layout_info, None)
        }?;
        let name = std::ffi::CString::new("main").unwrap();
        let stage_info = vk::PipelineShaderStageCreateInfo::default()
            .stage(vk::ShaderStageFlags::COMPUTE)
            .name(name.as_c_str())
            .module(shader);

        let pipeline_info = &[vk::ComputePipelineCreateInfo::default()
            .layout(gradient_pipeline_layout)
            .stage(stage_info)];

        let gradient_pipeline = unsafe {
            context
                .device()
                .create_compute_pipelines(vk::PipelineCache::null(), pipeline_info, None)
                .map_err(|err| anyhow::anyhow!(err.1))
        }?[0];

        Ok(Self {
            context: context.clone(),
            descriptor_allocator,
            draw_image,
            draw_image_descriptors: desc_sets,
            draw_image_layout: desc_layout,
            gradient_pipeline,
            gradient_pipeline_layout,
        })
    }

    pub fn render(
        &mut self,
        command_buffer: &CommandBuffer,
        swapchain_image: &vk::Image,
    ) -> Result<()> {
        let context = &self.context;
        let swapchain_extent = context.swapchain().extent().into();
        let draw_image = self.draw_image.inner;
        let draw_extent: Extent3D = self.draw_image.extent;

        self.context.transition_image(
            command_buffer,
            draw_image,
            vk::ImageLayout::UNDEFINED,
            vk::ImageLayout::GENERAL,
        );

        self.render_background(command_buffer);

        self.context.transition_image(
            command_buffer,
            draw_image,
            vk::ImageLayout::GENERAL,
            vk::ImageLayout::TRANSFER_SRC_OPTIMAL,
        );
        self.context.transition_image(
            command_buffer,
            *swapchain_image,
            vk::ImageLayout::UNDEFINED,
            vk::ImageLayout::TRANSFER_DST_OPTIMAL,
        );
        self.context.copy_image(
            command_buffer,
            draw_image,
            *swapchain_image,
            draw_extent,
            swapchain_extent,
        );
        self.context.transition_image(
            command_buffer,
            *swapchain_image,
            vk::ImageLayout::TRANSFER_DST_OPTIMAL,
            vk::ImageLayout::PRESENT_SRC_KHR,
        );

        Ok(())
    }

    fn render_background(&self, cmd: &CommandBuffer) {
        let device = self.context.device();

        unsafe {
            device.cmd_bind_pipeline(
                cmd.inner,
                vk::PipelineBindPoint::COMPUTE,
                self.gradient_pipeline,
            );

            let extent = self.draw_image.extent;
            let descriptors = &[self.draw_image_descriptors];
            device.cmd_bind_descriptor_sets(
                cmd.inner,
                vk::PipelineBindPoint::COMPUTE,
                self.gradient_pipeline_layout,
                0,
                descriptors,
                &[],
            );

            device.cmd_dispatch(
                cmd.inner,
                f32::ceil(extent.width as f32 / 16.0) as u32,
                f32::ceil(extent.height as f32 / 16.0) as u32,
                1,
            );
        };
    }
}
#[allow(dead_code)]
pub struct Renderer {
    context: Context,
    frames: Vec<Frame>,
    graphics: GraphicsRenderer,
    ui: UiRenderer,
    rebuild_swapchain: bool,
    current_frame: usize,
}

impl fmt::Debug for Renderer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Renderer").finish_non_exhaustive()
    }
}

impl Renderer {
    pub fn new(context: Context) -> Result<Self> {
        let graphics = GraphicsRenderer::new(&context)?;
        let ui = UiRenderer::new(&context)?;
        let frames = Self::init_frames(context.clone())?;

        Ok(Self {
            context,
            frames,
            graphics,
            ui,
            current_frame: 0,
            rebuild_swapchain: false,
        })
    }

    pub fn ui_mut(&mut self) -> &mut UiRenderer {
        &mut self.ui
    }

    fn init_frames(context: Context) -> Result<Vec<Frame>> {
        (0..context.swapchain().image_views().len())
            .map(|_| {
                let command_pool = context.create_command_pool()?;
                let command_buffer = CommandBuffer::new(context.device(), command_pool)?;

                Ok(Frame {
                    swapchain_semaphore: context.create_semaphore()?,
                    render_semaphore: context.create_semaphore()?,
                    fence: context.create_fence_signaled()?,
                    command_pool,
                    command_buffer,
                })
            })
            .collect()
    }

    pub fn handle_event(&mut self, event: &winit::event::Event<()>) {
        self.ui.handle_event(event.clone());
    }

    pub fn render(&mut self) -> Result<()> {
        let context = &mut self.context;
        let frame = &self.frames[self.current_frame % self.frames.len()];
        if self.rebuild_swapchain {
            context.swapchain_mut().rebuild()?;
            self.rebuild_swapchain = false;
        }

        let fence = frame.fence;
        let command_buffer = &frame.command_buffer;
        let render_semaphore = &frame.render_semaphore;
        let swapchain_semaphore = &frame.swapchain_semaphore;

        context.wait_for_fence(fence)?;
        let (image_index, rebuild) = context.swapchain_mut().next_image(*swapchain_semaphore)?;
        let swapchain_image = context.swapchain().images()[image_index as usize];
        let swapchain_image_view = context.swapchain().image_views()[image_index as usize];
        self.rebuild_swapchain = rebuild;

        context.reset_fence(fence)?;
        command_buffer.reset()?;
        command_buffer.begin()?;

        self.graphics.render(command_buffer, &swapchain_image)?;
        self.ui.render(command_buffer, &swapchain_image_view)?;

        command_buffer.end()?;
        command_buffer.submit(swapchain_semaphore, render_semaphore, fence)?;

        self.rebuild_swapchain |= self
            .context
            .swapchain_mut()
            .present(&[*render_semaphore], &[image_index])?;

        self.current_frame = self.current_frame.wrapping_add(1);

        Ok(())
    }
}
