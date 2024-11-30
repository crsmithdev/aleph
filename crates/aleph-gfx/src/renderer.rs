use {
    aleph_hal::{
        vk::{
            descriptor::DescriptorAllocator,
            image::{Image, ImageInfo},
        },
        Frame,
        RenderBackend,
        Swapchain,
        SwapchainInfo,
    },
    anyhow::Result,
    ash::vk::{self, Extent3D},
    std::{fmt, sync::Arc},
};

#[allow(dead_code)]
pub struct Renderer {
    backend: RenderBackend,
    frames: Vec<Frame>,
    current_frame: usize,
    swapchain_index: usize,
    swapchain_invalid: bool,
    descriptor_allocator: Arc<DescriptorAllocator>,
    draw_image: Image,
    draw_image_descriptors: vk::DescriptorSet,
    draw_image_layout: vk::DescriptorSetLayout,
    gradient_pipeline: vk::Pipeline,
    gradient_pipeline_layout: vk::PipelineLayout,
}

impl fmt::Debug for Renderer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Renderer").finish_non_exhaustive()
    }
}

impl Renderer {
    pub fn new(backend: RenderBackend) -> Result<Self> {
        let swapchain = backend.swapchain();
        let extent = backend.swapchain().extent();
        let frames = Self::init_frames(&backend, swapchain)?;
        let draw_image = Image::new(&ImageInfo {
            allocator: backend.allocator(),
            width: extent.width as usize,
            height: extent.height as usize,
            format: vk::Format::R16G16B16A16_SFLOAT,
            usage: vk::ImageUsageFlags::COLOR_ATTACHMENT
                | vk::ImageUsageFlags::TRANSFER_DST
                | vk::ImageUsageFlags::TRANSFER_SRC
                | vk::ImageUsageFlags::STORAGE,
        })?;
        let descriptor_allocator = Arc::new(DescriptorAllocator::new(
            backend.device(),
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
        let desc_layout = backend.create_descriptor_set_layout(
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

        backend.update_descriptor_sets(image_write, &[]);

        let layouts = &[desc_layout];
        let shader = backend.load_shader("shaders/gradient.spv")?;

        let pipeline_layout_info = vk::PipelineLayoutCreateInfo::default().set_layouts(layouts);
        let gradient_pipeline_layout = unsafe {
            backend
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
            backend
                .device()
                .create_compute_pipelines(vk::PipelineCache::null(), pipeline_info, None)
                .map_err(|err| anyhow::anyhow!(err.1))
        }?[0];

        Ok(Renderer {
            backend,
            descriptor_allocator,
            frames,
            current_frame: 0,
            swapchain_index: 1,
            gradient_pipeline,
            gradient_pipeline_layout,
            draw_image,
            draw_image_descriptors: desc_sets,
            draw_image_layout: desc_layout,
            swapchain_invalid: false,
        })
    }

    fn init_frames(backend: &RenderBackend, swapchain: &Swapchain) -> Result<Vec<Frame>> {
        (0..swapchain.image_views().len())
            .map(|index| {
                let pool = backend.create_command_pool()?;
                Ok(Frame {
                    index,
                    swapchain_semaphore: backend.create_semaphore()?,
                    render_semaphore: backend.create_semaphore()?,
                    fence: backend.create_fence_signaled()?,
                    command_pool: pool,
                    command_buffer: backend.create_command_buffer(pool)?,
                })
            })
            .collect()
    }

    fn current_frame(&self) -> &Frame {
        &self.frames[self.current_frame % self.frames.len()]
    }

    pub fn begin_frame(&mut self) -> Result<()> {
        let Frame {
            command_buffer,
            fence,
            swapchain_semaphore,
            ..
        } = *self.current_frame();
        self.backend.wait_for_fence(fence)?;
        self.backend.reset_fence(fence)?;
        let (index, _needs_rebuild) = self
            .backend
            .swapchain_mut()
            .next_image(swapchain_semaphore, vk::Fence::null())?;

        self.swapchain_index = index as usize;
        self.backend.reset_command_buffer(command_buffer)?;
        self.backend.begin_command_buffer(command_buffer)?;

        Ok(())
    }

    pub fn end_frame(&mut self) -> Result<()> {
        let Frame {
            command_buffer,
            fence,
            swapchain_semaphore,
            render_semaphore,
            ..
        } = *self.current_frame();

        self.backend.end_command_buffer(command_buffer)?;
        self.backend.submit_queued(
            &command_buffer,
            &swapchain_semaphore,
            &render_semaphore,
            fence,
        )?;

        self.backend
            .swapchain_mut()
            .present(&[render_semaphore], &[self.swapchain_index as u32])?;
        self.current_frame = self.current_frame.wrapping_add(1);

        Ok(())
    }

    pub fn render(&mut self) -> Result<()> {
        let swapchain_image = self.backend.swapchain().images()[self.swapchain_index];
        let swapchain_extent: Extent3D = self.backend.swapchain().extent().into();
        let draw_image = self.draw_image.inner;
        let draw_extent: Extent3D = self.draw_image.extent;
        let cmd = self.current_frame().command_buffer;

        self.backend.transition_image(
            cmd,
            draw_image,
            vk::ImageLayout::UNDEFINED,
            vk::ImageLayout::GENERAL,
        );

        self.draw_background(cmd)?;

        self.backend.transition_image(
            cmd,
            draw_image,
            vk::ImageLayout::GENERAL,
            vk::ImageLayout::TRANSFER_SRC_OPTIMAL,
        );
        self.backend.transition_image(
            cmd,
            swapchain_image,
            vk::ImageLayout::UNDEFINED,
            vk::ImageLayout::TRANSFER_DST_OPTIMAL,
        );
        self.backend.copy_image(
            cmd,
            draw_image,
            swapchain_image,
            draw_extent,
            swapchain_extent,
        );
        self.backend.transition_image(
            cmd,
            swapchain_image,
            vk::ImageLayout::TRANSFER_DST_OPTIMAL,
            vk::ImageLayout::PRESENT_SRC_KHR,
        );

        Ok(())
    }

    // fn submit_immediate<F: FnOnce(vk::CommandBuffer)>(
    //     &self,
    //     cmd: vk::CommandBuffer,
    //     wait_semaphore: vk::Semaphore,
    //     signal_semaphore: vk::Semaphore,
    //     fence: vk::Fence,
    //     f: F,
    // ) -> Result<()> {
    //     self.backend.reset_fence(fence)?;
    //     self.backend.reset_command_buffer(cmd)?;
    //     self.backend.begin_command_buffer(cmd)?;

    //     f(cmd);

    //     self.backend.end_command_buffer(cmd)?;

    //     self.backend
    //         .submit_queued(&cmd, &wait_semaphore, &signal_semaphore, fence)?;
    //     self.backend.wait_for_fence(fence)?;

    //     Ok(())
    // }

    fn draw_background(&mut self, cmd: vk::CommandBuffer) -> Result<(), anyhow::Error> {
        unsafe {
            self.backend.device().cmd_bind_pipeline(
                cmd,
                vk::PipelineBindPoint::COMPUTE,
                self.gradient_pipeline,
            );

            let extent = self.draw_image.extent;
            let descriptors = &[self.draw_image_descriptors];
            self.backend.device().cmd_bind_descriptor_sets(
                cmd,
                vk::PipelineBindPoint::COMPUTE,
                self.gradient_pipeline_layout,
                0,
                descriptors,
                &[],
            );

            self.backend.device().cmd_dispatch(
                cmd,
                f32::ceil(extent.width as f32 / 16.0) as u32,
                f32::ceil(extent.height as f32 / 16.0) as u32,
                1,
            );
        };

        Ok(())
    }

    pub fn present(&mut self, semaphore: vk::Semaphore, image_index: u32) -> Result<bool> {
        let wait_semaphores = &[semaphore];
        let indices = &[image_index];

        self.backend
            .swapchain_mut()
            .present(wait_semaphores, indices)
    }
}
 