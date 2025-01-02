use {
    crate::vk::Device,
    anyhow::Result,
    ash::vk,
    derive_more::{Debug, Deref},
};

#[allow(dead_code)]
#[derive(Clone, Debug, Deref)]
pub struct CommandBuffer {
    #[deref]
    pub inner: vk::CommandBuffer,
    pool: vk::CommandPool,
    device: Device,
}

impl CommandBuffer {
    pub fn new(device: &Device, pool: vk::CommandPool) -> Result<CommandBuffer> {
        let device = device.clone();
        let info = vk::CommandBufferAllocateInfo::default()
            .command_buffer_count(1)
            .command_pool(pool)
            .level(vk::CommandBufferLevel::PRIMARY);

        let inner = unsafe {
            device
                .inner
                .allocate_command_buffers(&info)
                .map(|b| b[0])
                .map_err(anyhow::Error::from)
        }?;

        Ok(CommandBuffer {
            inner,
            pool,
            device,
        })
    }

    pub fn reset(&self) -> Result<()> {
        #[allow(clippy::unit_arg)]
        Ok(unsafe {
            self.device
                .inner
                .reset_command_buffer(self.inner, vk::CommandBufferResetFlags::RELEASE_RESOURCES)?
        })
    }

    pub fn begin(&self) -> Result<()> {
        let info = vk::CommandBufferBeginInfo::default()
            .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT);

        #[allow(clippy::unit_arg)]
        Ok(unsafe { self.device.inner.begin_command_buffer(self.inner, &info)? })
    }

    pub fn end(&self) -> Result<()> {
        #[allow(clippy::unit_arg)]
        Ok(unsafe { self.device.inner.end_command_buffer(self.inner)? })
    }

    pub fn begin_rendering2(
        &self,
        color_attachments: &[vk::RenderingAttachmentInfo],
        depth_attachment: Option<&vk::RenderingAttachmentInfo>,
        extent: vk::Extent2D,
    ) -> Result<()> {
        let mut rendering_info = vk::RenderingInfo::default()
            .render_area(vk::Rect2D {
                offset: vk::Offset2D { x: 0, y: 0 },
                extent,
            })
            .layer_count(1)
            .color_attachments(color_attachments);

        if let Some(attachment) = depth_attachment {
            rendering_info = rendering_info.depth_attachment(attachment);
        }

        #[allow(clippy::unit_arg)]
        Ok(unsafe {
            self.device
                .inner
                .cmd_begin_rendering(self.inner, &rendering_info)
        })
    }
    // pub fn begin_rendering(&self, image_view: &vk::ImageView, extent: vk::Extent2D) -> Result<()>
    // {     let color_attachment_info = vk::RenderingAttachmentInfo::default()
    //         .image_view(*image_view)
    //         .image_layout(vk::ImageLayout::ATTACHMENT_OPTIMAL)
    //         .load_op(vk::AttachmentLoadOp::DONT_CARE)
    //         .store_op(vk::AttachmentStoreOp::STORE)
    //         .clear_value(vk::ClearValue {
    //             color: vk::ClearColorValue { float32: [1.0; 4] },
    //         });

    //     let rendering_info = vk::RenderingInfo::default()
    //         .render_area(vk::Rect2D {
    //             offset: vk::Offset2D { x: 0, y: 0 },
    //             extent,
    //         })
    //         .layer_count(1)
    //         .color_attachments(std::slice::from_ref(&color_attachment_info));

    //     #[allow(clippy::unit_arg)]
    //     Ok(unsafe {
    //         self.device
    //             .inner
    //             .cmd_begin_rendering(self.inner, &rendering_info)
    //     })
    // }

    pub fn end_rendering(&self) -> Result<()> {
        #[allow(clippy::unit_arg)]
        Ok(unsafe { self.device.inner.cmd_end_rendering(self.inner) })
    }

    pub fn submit(
        &self,
        wait_semaphore: &vk::Semaphore,
        signal_semaphore: &vk::Semaphore,
        fence: vk::Fence,
    ) -> Result<(), anyhow::Error> {
        let cmd = &self.inner;
        let queue = &self.device.queue;

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

        Ok(unsafe {
            self.device
                .inner
                .queue_submit2(queue.inner, submit_info, fence)
        }?)
    }

    pub fn submit_immediate(
        &self,
        _callback: impl FnOnce(vk::CommandBuffer)) -> Result<()> {
            Ok(())
        // unsafe { self.device.inner.reset_fences(&[fence])? };
        // unsafe { self.device.inner.reset_command_buffer(self.inner, vk::CommandBufferResetFlags::RELEASE_RESOURCES) }?;
        // self.begin()?;
        // callback(self.inner);
        // self.end()?;
        // self.submit(&vk::Semaphore::null(), &vk::Semaphore::null(), vk::Fence::null())
    }
}
