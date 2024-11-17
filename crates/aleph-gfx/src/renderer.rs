use {
    aleph_core::constants::VK_TIMEOUT_NS,
    aleph_hal::vk::{
        backend::RenderBackend,
        descriptor::DescriptorAllocator,
        image::{Image, ImageInfo},
        swapchain::Frame,
    },
    anyhow::Result,
    ash::vk::{self, Extent3D},
    // imgui,
    std::{fmt, sync::Arc},
};

#[allow(dead_code)]
pub struct Renderer {
    backend: RenderBackend,
    frames: Vec<Frame>,
    current_frame: usize,
    descriptor_allocator: Arc<DescriptorAllocator>,
    draw_image: Image,
    draw_image_descriptors: vk::DescriptorSet,
    draw_image_layout: vk::DescriptorSetLayout,
    gradient_pipeline: vk::Pipeline,
    gradient_pipeline_layout: vk::PipelineLayout,
    imgui_fence: vk::Fence,
    imgui_command_buffer: vk::CommandBuffer,
    imgui_command_pool: vk::CommandPool,
    imgui_context: imgui::Context,
}

impl fmt::Debug for Renderer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Renderer").finish_non_exhaustive()
    }
}

impl Renderer {
    pub fn new(backend: RenderBackend) -> Result<Self> {
        let frames = Self::init_frames(&backend)?;
        let draw_image = Image::new(&ImageInfo {
            allocator: &backend.allocator,
            width: backend.swapchain.extent.width as usize,
            height: backend.swapchain.extent.height as usize,
            format: vk::Format::R16G16B16A16_SFLOAT,
            usage: vk::ImageUsageFlags::COLOR_ATTACHMENT
                | vk::ImageUsageFlags::TRANSFER_DST
                | vk::ImageUsageFlags::TRANSFER_SRC
                | vk::ImageUsageFlags::STORAGE,
        })?;
        let descriptor_allocator = Arc::new(DescriptorAllocator::new(
            &backend.device,
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
        let desc_layout_info = vk::DescriptorSetLayoutCreateInfo::default()
            .bindings(desc_bindings)
            .flags(vk::DescriptorSetLayoutCreateFlags::empty());
        let desc_layout = unsafe {
            backend
                .device
                .create_descriptor_set_layout(&desc_layout_info, None)
        }?;

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

        unsafe {
            backend
                .device
                .update_descriptor_sets(image_write, &[])
        };

        let layouts = &[desc_layout];
        let shader = backend.load_shader("shaders/gradient.spv")?;

        let pipeline_layout_info = vk::PipelineLayoutCreateInfo::default().set_layouts(layouts);
        let gradient_pipeline_layout = unsafe {
            backend
                .device
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
                .device
                .create_compute_pipelines(vk::PipelineCache::null(), pipeline_info, None)
                .map_err(|err| anyhow::anyhow!(err.1))
        }?[0];
        log::info!("Created background pipeline: {:?}", &gradient_pipeline);

        let imgui_command_pool = backend.create_command_pool()?;
        let imgui_command_buffer = backend.create_command_buffer(imgui_command_pool)?;
        let imgui_fence = backend.create_fence()?;
        let imgui_context = imgui::Context::create();

        Ok(Renderer {
            backend,
            descriptor_allocator,
            frames,
            current_frame: 0,
            gradient_pipeline,
            gradient_pipeline_layout,
            draw_image,
            draw_image_descriptors: desc_sets,
            draw_image_layout: desc_layout,
            imgui_command_buffer,
            imgui_command_pool,
            imgui_fence,
            imgui_context,
        })
    }

    fn init_frames(backend: &RenderBackend) -> Result<Vec<Frame>> {
        (0..backend.swapchain.image_views.len())
            .map(|index| {
                let pool = backend.create_command_pool()?;
                dbg!(pool);
                let s =  backend.create_semaphore()?;
                dbg!(s);
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

    pub fn render(&mut self) -> Result<()> {
        self.backend.wait_for_fence(self.current_frame().fence)?;
        self.backend.reset_fence(self.current_frame().fence)?;

        let index = self.next_frame()?;
        let swapchain = &self.backend.swapchain;
        let swapchain_image = swapchain.images[index as usize];
        let swapchain_extent: Extent3D = swapchain.extent.into();
        let draw_image = self.draw_image.inner;
        let draw_extent: Extent3D = self.draw_image.extent.into();

        let Frame {
            command_buffer: cmd,
            fence,
            swapchain_semaphore,
            render_semaphore,
            ..
        } = *self.current_frame();

        self.backend.reset_command_buffer(cmd)?;
        self.backend.begin_command_buffer(cmd)?;
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

        self.backend.end_command_buffer(cmd)?;

        self.backend
            .queue_submit(&cmd, &swapchain_semaphore, &render_semaphore, fence)?;
        self.backend.present(render_semaphore, index as u32)?;

        self.current_frame = self.current_frame + 1;

        Ok(())
    }

    // fn immediate_submit<F: FnOnce(&Device, vk::CommandBuffer)>(
    //     &self,
    //     device: &Device,
    //     cmd: vk::CommandBuffer,
    //     fence: vk::Fence,
    //     wait_semaphores: &[vk::Semaphore],
    //     signal_semaphores: &[vk::Semaphore],
    //     f: F,
    // ) -> Result<()> {
    //     self.backend.device.reset_fence(fence)?;

    //     unsafe {
    //         self.backend
    //             .device
    //             .inner
    //             .reset_command_buffer(cmd, CommandBufferResetFlags::default())
    //     }?;

    //     let info = vk::CommandBufferBeginInfo::default()
    //         .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT);
    //     unsafe {
    //         self.backend.device.inner.begin_command_buffer(cmd, &info)?;
    //     }

    // f(&device, cmd);

    // let wait_info: &Vec<vk::SemaphoreSubmitInfo<'_>> = &wait_semaphores
    //     .into_iter()
    //     .map(|s| vk::SemaphoreSubmitInfo::default().semaphore(*s).value(1))
    //     .collect();
    // let signal_info: &Vec<vk::SemaphoreSubmitInfo<'_>> = &signal_semaphores
    //     .into_iter()
    //     .map(|s| vk::SemaphoreSubmitInfo::default().semaphore(*s).value(1))
    //     .collect();
    // let command_buffer_info = &[vk::CommandBufferSubmitInfo::default()
    //     .command_buffer(cmd)
    //     .device_mask(0)];

    // let submit_info = &[vk::SubmitInfo2::default()
    //     .command_buffer_infos(command_buffer_info)
    //     .wait_semaphore_infos(wait_info)
    //     .signal_semaphore_infos(signal_info)];

    // unsafe {
    //     self.backend.device.inner.queue_submit2(
    //         self.backend.device.queue.inner,
    //         submit_info,
    //         self.current_frame().fence,
    //     )
    // }?;

    // Ok(())
    // }

    fn draw_background(
        &mut self,
        cmd: vk::CommandBuffer,
    ) -> Result<(), anyhow::Error> {
        unsafe {
            self.backend.device.cmd_bind_pipeline(
                cmd,
                vk::PipelineBindPoint::COMPUTE,
                self.gradient_pipeline,
            );

            let extent = self.draw_image.extent;
            let descriptors = &[self.draw_image_descriptors];
            self.backend.device.cmd_bind_descriptor_sets(
                cmd,
                vk::PipelineBindPoint::COMPUTE,
                self.gradient_pipeline_layout,
                0,
                descriptors,
                &[],
            );

            self.backend.device.cmd_dispatch(
                cmd,
                f32::ceil(extent.width as f32 / 16.0) as u32,
                f32::ceil(extent.height as f32 / 16.0) as u32,
                1,
            );
        };

        Ok(())
    }

    pub fn resize(&mut self, width: u32, height: u32) -> Result<()> {
        self.backend.resize(width, height)
    }

    fn next_frame(&mut self) -> Result<u32> {
        let (index, _) = unsafe {
            self.backend.swapchain.fns.acquire_next_image(
                self.backend.swapchain.inner,
                VK_TIMEOUT_NS,
                self.current_frame().swapchain_semaphore,
                vk::Fence::null(),
            )?
        };
        Ok(index)
    }
}
