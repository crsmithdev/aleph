use {
    aleph_core::constants::VK_TIMEOUT_NS,
    aleph_hal::vk::{
        descriptor::DescriptorAllocator,
        image::{Image, ImageInfo},
        render_backend::RenderBackend,
        shader::Shader,
        swapchain::Frame,
    },
    anyhow::{bail, Result},
    ash::vk::{self, CommandBufferResetFlags, Extent2D, Extent3D},
    std::{
        ffi::CStr,
        fmt::{self, Debug},
        sync::Arc,
    },
};

struct Pipeline {
    inner: vk::Pipeline,
    layout: vk::PipelineLayout,
    descriptors: Vec<vk::DescriptorSet>,
}

impl Debug for Pipeline {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Pipeline")
            .field("inner", &self.inner)
            .field("layout", &self.layout)
            .field("descriptors", &self.descriptors)
            .finish()
    }
}

pub struct Renderer {
    backend: RenderBackend,
    frames: Vec<Frame>,
    current_frame: usize,
    extent: Extent2D,
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
                .inner
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
                .inner
                .update_descriptor_sets(image_write, &[])
        };

        let layouts = &[desc_layout];
        let shader = backend.device.load_shader("shaders/gradient.spv")?;

        let pipeline_layout_info = vk::PipelineLayoutCreateInfo::default().set_layouts(layouts);
        let gradient_pipeline_layout = unsafe {
            backend
                .device
                .inner
                .create_pipeline_layout(&pipeline_layout_info, None)
        }?;
        let name = std::ffi::CString::new("main").unwrap();
        let stage_info = vk::PipelineShaderStageCreateInfo::default()
            .stage(vk::ShaderStageFlags::COMPUTE)
            .name(name.as_c_str())
            .module(shader.inner);

        let pipeline_info = &[vk::ComputePipelineCreateInfo::default()
            .layout(gradient_pipeline_layout)
            .stage(stage_info)];

        let gradient_pipeline = unsafe {
            backend
                .device
                .inner
                .create_compute_pipelines(vk::PipelineCache::null(), pipeline_info, None)
                .map_err(|err| anyhow::anyhow!(err.1))
        }?[0];
        log::info!("Created background pipeline: {:?}", &gradient_pipeline);

        Ok(Renderer {
            backend,
            descriptor_allocator,
            frames,
            current_frame: 0,
            extent: vk::Extent2D::default(),
            gradient_pipeline,
            gradient_pipeline_layout,
            draw_image,
            draw_image_descriptors: desc_sets,
            draw_image_layout: desc_layout,
        })
    }

    fn init_frames(backend: &RenderBackend) -> Result<Vec<Frame>> {
        (0..backend.swapchain.image_views.len())
            .map(|index| {
                let pool = backend.create_command_pool();
                Ok(Frame {
                    index,
                    swapchain_semaphore: backend.device.create_semaphore()?,
                    render_semaphore: backend.device.create_semaphore()?,
                    fence: backend.device.create_fence_signaled()?,
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
        self.backend
            .device
            .wait_for_fence(self.current_frame().fence)?;

        let index = self.next_frame()?;
        let swapchain_image = self.backend.swapchain.images[index as usize];

        self.backend
            .device
            .reset_fence(self.current_frame().fence)?;

        let cmd = self.current_frame().command_buffer;
        unsafe {
            self.backend
                .device
                .inner
                .reset_command_buffer(cmd, CommandBufferResetFlags::default())
        }?;

        let info = vk::CommandBufferBeginInfo::default()
            .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT);
        unsafe { self.backend.device.inner.begin_command_buffer(cmd, &info)? }

        // draw_image, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_GENERAL

        // draw_background(cmd);

        // draw_image VK_IMAGE_LAYOUT_GENERAL,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL);
        // swapchaim_image VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL);
        // copy draw_image, swapchain_image, _drawExtent, _swapchainExtent);
        // swapchain_image, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, VK_IMAGE_LAYOUT_PRESENT_SRC_KHR);

        // let draw_image = self.backend.swapchain.draw_image.inner;
        let draw_extent = Extent3D {
            width: self.backend.swapchain.extent.width,
            height: self.backend.swapchain.extent.height,
            depth: 1,
        };
        self.backend.transition_image(
            cmd,
            self.draw_image.inner,
            vk::ImageLayout::UNDEFINED,
            vk::ImageLayout::GENERAL,
        );

        self.draw_background(cmd, self.draw_image.inner)?;

        self.backend.transition_image(
            cmd,
            self.draw_image.inner,
            vk::ImageLayout::GENERAL,
            vk::ImageLayout::TRANSFER_SRC_OPTIMAL,
        );
        self.backend.transition_image(
            cmd,
            swapchain_image,
            vk::ImageLayout::UNDEFINED,
            vk::ImageLayout::TRANSFER_DST_OPTIMAL,
        );
        self.backend.copy_image_to_image(
            cmd,
            self.draw_image.inner,
            swapchain_image,
            self.draw_image.extent,
            draw_extent,
        );
        self.backend.transition_image(
            cmd,
            swapchain_image,
            vk::ImageLayout::TRANSFER_DST_OPTIMAL,
            vk::ImageLayout::PRESENT_SRC_KHR,
        );

        unsafe { self.backend.device.inner.end_command_buffer(cmd)? };

        let wait_info = &[vk::SemaphoreSubmitInfo::default()
            .semaphore(self.current_frame().swapchain_semaphore)
            .stage_mask(vk::PipelineStageFlags2::COLOR_ATTACHMENT_OUTPUT)
            .value(1)];
        let signal_info = &[vk::SemaphoreSubmitInfo::default()
            .semaphore(self.current_frame().render_semaphore)
            .stage_mask(vk::PipelineStageFlags2::ALL_GRAPHICS)
            .value(1)];
        let command_buffer_info = &[vk::CommandBufferSubmitInfo::default()
            .command_buffer(cmd)
            .device_mask(0)];

        let submit_info = &[vk::SubmitInfo2::default()
            .command_buffer_infos(command_buffer_info)
            .wait_semaphore_infos(wait_info)
            .signal_semaphore_infos(signal_info)];

        unsafe {
            self.backend.device.inner.queue_submit2(
                self.backend.device.queue.inner,
                submit_info,
                self.current_frame().fence,
            )
        }?;

        let wait_semaphores = [self.current_frame().render_semaphore];
        let swapchains = [self.backend.swapchain.inner];
        let indices = [index];

        let present_info = vk::PresentInfoKHR::default()
            .wait_semaphores(&wait_semaphores)
            .swapchains(&swapchains)
            .image_indices(&indices);

        unsafe {
            let result = self
                .backend
                .swapchain
                .loader
                .queue_present(self.backend.device.queue.inner, &present_info);
            match result {
                Ok(_) => {}
                Err(vk::Result::ERROR_OUT_OF_DATE_KHR | vk::Result::SUBOPTIMAL_KHR) => {
                    self.backend.resize(self.extent.width, self.extent.height)?;
                }
                Err(err) => bail!(err),
            }
        };

        self.current_frame = self.current_frame + 1;

        Ok(())
    }

    fn draw_background(
        &mut self,
        cmd: vk::CommandBuffer,
        image: vk::Image,
    ) -> Result<(), anyhow::Error> {
        // let flash = (self.current_frame as f32 / 120.0).sin().abs();
        // let color = vk::ClearColorValue {
        //     float32: [0.0, 0.0, flash, 1.0],
        // };
        // let ranges = [vk::ImageSubresourceRange {
        //     aspect_mask: vk::ImageAspectFlags::COLOR,
        //     base_mip_level: 0,
        //     level_count: 1,
        //     base_array_layer: 0,
        //     layer_count: 1,
        // }];
        unsafe {
            // self.backend.device.inner.cmd_clear_color_image(
            //     cmd,
            //     image,
            //     vk::ImageLayout::GENERAL,
            //     &color,
            //     &ranges,
            // );
            self.backend.device.inner.cmd_bind_pipeline(
                cmd,
                vk::PipelineBindPoint::COMPUTE,
                self.gradient_pipeline,
            );

            let descriptors = &[self.draw_image_descriptors];

            self.backend.device.inner.cmd_bind_descriptor_sets(
                cmd,
                vk::PipelineBindPoint::COMPUTE,
                self.gradient_pipeline_layout,
                0,
                descriptors,
                &[],
            );
            let extent = self.draw_image.extent;
            self.backend.device.inner.cmd_dispatch(
                cmd,
                f32::ceil(extent.width as f32 / 16.0) as u32,
                f32::ceil(extent.height as f32 / 16.0) as u32,
                1,
            );
            // self.backend.transition_image(
            //     cmd,
            //     image,
            //     vk::ImageLayout::GENERAL,
            //     vk::ImageLayout::PRESENT_SRC_KHR,
            // );
            // self.backend.device.inner.end_command_buffer(cmd)?;
        };
        Ok(())
    }

    pub fn resize(&mut self, width: u32, height: u32) -> Result<()> {
        // self.backend.resize(width, height)
        Ok(())
    }

    fn next_frame(&mut self) -> Result<u32> {
        let (index, _) = unsafe {
            self.backend.swapchain.loader.acquire_next_image(
                self.backend.swapchain.inner,
                VK_TIMEOUT_NS,
                self.current_frame().swapchain_semaphore,
                vk::Fence::null(),
            )?
        };
        Ok(index)
    }
}
