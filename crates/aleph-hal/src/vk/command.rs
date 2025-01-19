use {
    crate::{Device, Queue},
    anyhow::Result,
    ash::vk,
    derive_more::{Debug, Deref},
};

#[derive(Clone, Debug)]
pub struct CommandPool {
    pub(crate) handle: vk::CommandPool,
    pub(crate) device: Device,
    pub(crate) queue: Queue,
}

impl CommandPool {

    pub fn handle(&self) -> vk::CommandPool {
        self.handle
    }
    
    pub fn create_command_buffer(&self) -> Result<CommandBuffer> {
        let info = vk::CommandBufferAllocateInfo::default()
            .command_pool(self.handle)
            .level(vk::CommandBufferLevel::PRIMARY)
            .command_buffer_count(1);

        let handle = unsafe { self.device.allocate_command_buffers(&info)?[0] };
        let fence = self.device.create_fence_signaled()?;

        Ok(CommandBuffer {
            handle,
            pool: self.handle,
            device: self.device.clone(),
            queue: self.queue,
            fence,
        })
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deref)]
pub struct CommandBuffer {
    #[deref]
    pub(crate) handle: vk::CommandBuffer,
    pub(crate) pool: vk::CommandPool,
    pub(crate) device: Device,
    pub(crate) queue: Queue,
    pub(crate) fence: vk::Fence,
}

impl CommandBuffer {
    pub fn handle(&self) -> vk::CommandBuffer {
        self.handle
    }
    pub fn reset(&self) -> Result<()> {
        #[allow(clippy::unit_arg)]
        Ok(unsafe {
            self.device
                .reset_command_buffer(self.handle, vk::CommandBufferResetFlags::RELEASE_RESOURCES)?
        })
    }

    pub fn begin(&self) -> Result<()> {
        let info = vk::CommandBufferBeginInfo::default()
            .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT);

        #[allow(clippy::unit_arg)]
        Ok(unsafe { self.device.begin_command_buffer(self.handle, &info)? })
    }

    pub fn end(&self) -> Result<()> {
        #[allow(clippy::unit_arg)]
        Ok(unsafe { self.device.end_command_buffer(self.handle)? })
    }

    pub fn begin_rendering2(
        &self,
        color_attachments: &[vk::RenderingAttachmentInfo],
        extent: vk::Extent2D,
    ) -> Result<()> {
        let rendering_info = vk::RenderingInfo::default()
            .render_area(vk::Rect2D {
                offset: vk::Offset2D { x: 0, y: 0 },
                extent,
            })
            .layer_count(1)
            .color_attachments(color_attachments);

        #[allow(clippy::unit_arg)]
        Ok(unsafe {
            self.device
                .cmd_begin_rendering(self.handle, &rendering_info)
        })
    }

    pub fn draw(
        &self,
        vertex_count: u32,
        instance_count: u32,
        first_vertex: u32,
        first_instance: u32,
    ) {
        unsafe {
            self.device.cmd_draw(
                self.handle,
                vertex_count,
                instance_count,
                first_vertex,
                first_instance,
            )
        }
    }

    pub fn set_scissor(&self, scissor: vk::Rect2D) {
        unsafe {
            self.device
                .cmd_set_scissor(self.handle, 0, std::slice::from_ref(&scissor));
        }
    }

    pub fn set_viewport(&self, viewport: vk::Viewport) {
        unsafe {
            self.device
                .cmd_set_viewport(self.handle, 0, std::slice::from_ref(&viewport));
        }
    }

    pub fn begin_rendering(&self, image_view: &vk::ImageView, extent: vk::Extent2D) -> Result<()> {
        let color_attachment_info = vk::RenderingAttachmentInfo::default()
            .image_view(*image_view)
            .image_layout(vk::ImageLayout::ATTACHMENT_OPTIMAL)
            .load_op(vk::AttachmentLoadOp::DONT_CARE)
            .store_op(vk::AttachmentStoreOp::STORE)
            .clear_value(vk::ClearValue {
                color: vk::ClearColorValue { float32: [1.0; 4] },
            });

        let rendering_info = vk::RenderingInfo::default()
            .render_area(vk::Rect2D {
                offset: vk::Offset2D { x: 0, y: 0 },
                extent,
            })
            .layer_count(1)
            .color_attachments(std::slice::from_ref(&color_attachment_info));

        #[allow(clippy::unit_arg)]
        Ok(unsafe {
            self.device
                .handle
                .cmd_begin_rendering(self.handle, &rendering_info)
        })
    }

    pub fn end_rendering(&self) -> Result<()> {
        #[allow(clippy::unit_arg)]
        Ok(unsafe { self.device.handle.cmd_end_rendering(self.handle) })
    }

    pub fn bind_pipeline(
        &self,
        pipeline_bind_point: vk::PipelineBindPoint,
        pipeline: vk::Pipeline,
    ) -> Result<()> {
        #[allow(clippy::unit_arg)]
        Ok(unsafe {
            self.device
                .cmd_bind_pipeline(self.handle, pipeline_bind_point, pipeline);
        })
    }

    pub fn dispatch(&self, group_count_x: u32, group_count_y: u32, group_count_z: u32) {
        unsafe {
            self.device
                .cmd_dispatch(self.handle, group_count_x, group_count_y, group_count_z)
        }
    }

    pub fn push_descriptor_set(
        &self,
        bind_point: vk::PipelineBindPoint,
        layout: vk::PipelineLayout,
        set: vk::WriteDescriptorSet,
    ) {
        let sets = &[set];
        unsafe {
            self.device.push_descriptor.cmd_push_descriptor_set(
                self.handle,
                bind_point,
                layout,
                0,
                sets,
            );
        }
    }

    /*
        VK_CHECK(vkResetFences(_device, 1, &_immFence));
    VK_CHECK(vkResetCommandBuffer(_immCommandBuffer, 0));

    VkCommandBuffer cmd = _immCommandBuffer;

    VkCommandBufferBeginInfo cmdBeginInfo = vkinit::command_buffer_begin_info(VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT);

    VK_CHECK(vkBeginCommandBuffer(cmd, &cmdBeginInfo));

    function(cmd);

    VK_CHECK(vkEndCommandBuffer(cmd));

    VkCommandBufferSubmitInfo cmdinfo = vkinit::command_buffer_submit_info(cmd);
    VkSubmitInfo2 submit = vkinit::submit_info(&cmdinfo, nullptr, nullptr);

    // submit command buffer to the queue and execute it.
    //  _renderFence will now block until the graphic commands finish execution
    VK_CHECK(vkQueueSubmit2(_graphicsQueue, 1, &submit, _immFence));

    VK_CHECK(vkWaitForFences(_device, 1, &_immFence, true, 9999999999));
     */

    pub fn submit_immediate(
        &self,
        // wait_semaphore: &vk::Semaphore,
        // signal_semaphore: &vk::Semaphore,
        // fence: &[]// // // // // // // // Option<vk::Fence>,
        f: impl FnOnce(&CommandBuffer),
    ) -> Result<()> {
        self.device.wait_for_fence(self.fence)?;
        self.device.reset_fence(self.fence)?;
        self.reset()?;
        self.begin()?;

        f(self);

        self.end()?;

        // let wait_info = &[vk::SemaphoreSubmitInfo::default()
        //     .semaphore(*wait_semaphore)
        //     .stage_mask(vk::PipelineStageFlags2::COLOR_ATTACHMENT_OUTPUT)
        //     .value(1)];
        // let signal_info = &[vk::SemaphoreSubmitInfo::default()
        //     .semaphore(*signal_semaphore)
        //     .stage_mask(vk::PipelineStageFlags2::ALL_GRAPHICS)
        //     .value(1)];
        let command_buffer_info = &[vk::CommandBufferSubmitInfo::default()
            .command_buffer(self.handle)
            .device_mask(0)];
        let submit_info = &[vk::SubmitInfo2::default()
            .command_buffer_infos(command_buffer_info)
            .wait_semaphore_infos(&[])
            .signal_semaphore_infos(&[])];

        Ok(unsafe {
            self.device
                .queue_submit2(self.queue.handle, submit_info, self.fence)
        }?)
    }

    pub fn submit_queued(
        &self,
        wait_semaphore: &vk::Semaphore,
        signal_semaphore: &vk::Semaphore,
        fence: vk::Fence,
    ) -> Result<(), anyhow::Error> {
        let cmd = &self.handle;
        let queue = self.device.queue;

        let wait_info = &[vk::SemaphoreSubmitInfo::default()
            .semaphore(*wait_semaphore)
            .stage_mask(vk::PipelineStageFlags2::COLOR_ATTACHMENT_OUTPUT)
            .value(1)];
        let signal_info = &[vk::SemaphoreSubmitInfo::default()
            .semaphore(*signal_semaphore)
            .stage_mask(vk::PipelineStageFlags2::ALL_GRAPHICS)
            .value(1)];
        let command_buffer_info = &[vk::CommandBufferSubmitInfo::default()
            .command_buffer(*cmd)
            .device_mask(0)];
        let submit_info = &[vk::SubmitInfo2::default()
            .command_buffer_infos(command_buffer_info)
            .wait_semaphore_infos(wait_info)
            .signal_semaphore_infos(signal_info)];

        Ok(unsafe { self.device.queue_submit2(queue.handle, submit_info, fence) }?)
    }

    pub fn transition_image(
        &self,
        image: vk::Image,
        current_layout: vk::ImageLayout,
        new_layout: vk::ImageLayout,
    ) {
        let aspect_mask = match new_layout {
            vk::ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL => vk::ImageAspectFlags::DEPTH,
            _ => vk::ImageAspectFlags::COLOR,
        };
        let range = vk::ImageSubresourceRange::default()
            .aspect_mask(aspect_mask)
            .base_array_layer(0)
            .base_mip_level(0)
            .level_count(1)
            .layer_count(1);
        let barriers = &[vk::ImageMemoryBarrier2::default()
            .image(image)
            .src_stage_mask(vk::PipelineStageFlags2::ALL_COMMANDS)
            .src_access_mask(vk::AccessFlags2::MEMORY_WRITE)
            .dst_stage_mask(vk::PipelineStageFlags2::ALL_COMMANDS)
            .dst_access_mask(vk::AccessFlags2::MEMORY_WRITE | vk::AccessFlags2::MEMORY_READ)
            .old_layout(current_layout)
            .new_layout(new_layout)
            .subresource_range(range)];
        let dependency_info = vk::DependencyInfo::default().image_memory_barriers(barriers);

        unsafe {
            self.device
                .cmd_pipeline_barrier2(self.handle, &dependency_info);
        }
    }

    pub fn copy_image(
        &self,
        src: vk::Image,
        dst: vk::Image,
        src_extent: vk::Extent3D,
        dst_extent: vk::Extent3D,
    ) {
        let src_subresource = vk::ImageSubresourceLayers::default()
            .aspect_mask(vk::ImageAspectFlags::COLOR)
            .layer_count(1);
        let dst_subresource = vk::ImageSubresourceLayers::default()
            .aspect_mask(vk::ImageAspectFlags::COLOR)
            .layer_count(1);
        let src_offsets = [
            vk::Offset3D::default(),
            vk::Offset3D::default()
                .x(src_extent.width as i32)
                .y(src_extent.height as i32)
                .z(1),
        ];
        let dst_offsets = [
            vk::Offset3D::default(),
            vk::Offset3D::default()
                .x(dst_extent.width as i32)
                .y(dst_extent.height as i32)
                .z(1),
        ];
        let blit_region = vk::ImageBlit2::default()
            .src_subresource(src_subresource)
            .dst_subresource(dst_subresource)
            .src_offsets(src_offsets)
            .dst_offsets(dst_offsets);
        let regions = &[blit_region];
        let blit_info = vk::BlitImageInfo2::default()
            .src_image(src)
            .src_image_layout(vk::ImageLayout::TRANSFER_SRC_OPTIMAL)
            .dst_image(dst)
            .dst_image_layout(vk::ImageLayout::TRANSFER_DST_OPTIMAL)
            // .filter(vk::Filter::Linear)
            .regions(regions);

        unsafe { self.device.cmd_blit_image2(self.handle, &blit_info) }
    }
}
