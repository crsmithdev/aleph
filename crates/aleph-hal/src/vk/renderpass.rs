use {super::RenderBackend, crate::vk::Swapchain, anyhow::Result, ash::vk, std::sync::Arc};

pub struct RenderPass {
    pub inner: vk::RenderPass,
}

impl RenderBackend {
    pub fn create_render_pass(&self, swapchain: &Arc<Swapchain>) -> Result<RenderPass> {
        let attachments = [
            vk::AttachmentDescription {
                // format: swapchain.properties.format.format,
                // samples: vk::SampleCountFlags::TYPE_1,
                // load_op: vk::AttachmentLoadOp::CLEAR,
                // store_op: vk::AttachmentStoreOp::STORE,
                // stencil_load_op: vk::AttachmentLoadOp::DONT_CARE,
                // stencil_store_op: vk::AttachmentStoreOp::DONT_CARE,
                // initial_layout: vk::ImageLayout::UNDEFINED,
                // final_layout: vk::ImageLayout::PRESENT_SRC_KHR,
                format: swapchain.properties.format.format,
                samples: vk::SampleCountFlags::TYPE_1,
                load_op: vk::AttachmentLoadOp::CLEAR,
                store_op: vk::AttachmentStoreOp::STORE,
                final_layout: vk::ImageLayout::PRESENT_SRC_KHR,
                ..Default::default()
            },
            vk::AttachmentDescription {
                // samples: vk::SampleCountFlags::TYPE_1,
                // load_op: vk::AttachmentLoadOp::CLEAR,
                // store_op: vk::AttachmentStoreOp::STORE,
                // stencil_load_op: vk::AttachmentLoadOp::CLEAR,
                // stencil_store_op: vk::AttachmentStoreOp::DONT_CARE,
                // initial_layout: vk::ImageLayout::UNDEFINED,
                // final_layout: vk::ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
                format: vk::Format::D16_UNORM,
                samples: vk::SampleCountFlags::TYPE_1,
                load_op: vk::AttachmentLoadOp::CLEAR,
                initial_layout: vk::ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
                final_layout: vk::ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
                ..Default::default()
            },
        ];

        let color_attachment_refs = [vk::AttachmentReference {
            attachment: 0,
            layout: vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
        }];
        let depth_attachment_ref = vk::AttachmentReference {
            attachment: 1,
            layout: vk::ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
        };

        let dependencies = [
            // vk::SubpassDependency {
            //     src_subpass: vk::SUBPASS_EXTERNAL,
            //     src_stage_mask: vk::PipelineStageFlags::COLOR_ATTACHMENT_OUTPUT,
            //     dst_access_mask: vk::AccessFlags::COLOR_ATTACHMENT_WRITE,
            //     dst_stage_mask: vk::PipelineStageFlags::COLOR_ATTACHMENT_OUTPUT,
            //     ..Default::default()
            // },
            // vk::SubpassDependency {
            //     src_subpass: vk::SUBPASS_EXTERNAL,
            //     src_stage_mask: vk::PipelineStageFlags::EARLY_FRAGMENT_TESTS
            //         | vk::PipelineStageFlags::LATE_FRAGMENT_TESTS,
            //     dst_access_mask: vk::AccessFlags::DEPTH_STENCIL_ATTACHMENT_WRITE,
            //     dst_stage_mask: vk::PipelineStageFlags::EARLY_FRAGMENT_TESTS
            //         | vk::PipelineStageFlags::LATE_FRAGMENT_TESTS,
            //     ..Default::default()
            vk::SubpassDependency {
                src_subpass: vk::SUBPASS_EXTERNAL,
                src_stage_mask: vk::PipelineStageFlags::COLOR_ATTACHMENT_OUTPUT,
                dst_access_mask: vk::AccessFlags::COLOR_ATTACHMENT_WRITE,
                dst_stage_mask: vk::PipelineStageFlags::COLOR_ATTACHMENT_OUTPUT,
                ..Default::default()
            },
        ];

        let subpasses = [vk::SubpassDescription::default()
            .color_attachments(&color_attachment_refs)
            .depth_stencil_attachment(&depth_attachment_ref)
            .pipeline_bind_point(vk::PipelineBindPoint::GRAPHICS)];
        let renderpass_create_info = vk::RenderPassCreateInfo::default()
            .attachments(&attachments)
            .subpasses(&subpasses)
            .dependencies(&dependencies);
        let inner = unsafe {
            self.device
                .inner
                .create_render_pass(&renderpass_create_info, None)?
        };

        Ok(RenderPass { inner })
    }
}
