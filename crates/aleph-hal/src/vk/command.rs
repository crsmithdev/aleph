use {
    crate::Device,
    anyhow::Result,
    ash::vk,
    derive_more::{Debug, Deref},
};

#[allow(dead_code)]
#[derive(Clone, Debug, Deref)]
pub struct CommandBuffer {
    #[deref]
    pub(crate) handle: vk::CommandBuffer,
    pub(crate) pool: vk::CommandPool,
    pub(crate) device: Device,
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

    pub fn submit(
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
}
