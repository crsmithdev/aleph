use {
    aleph_hal::vk::{
        buffer::{Buffer, BufferDesc, BufferUsage, MemoryLocation},
        command_buffer::CommandBuffer,
        // pipeline::Pipeline,
        // render_pass::RenderPass,
        // swapchain::Framebuffers,
        RenderBackend,
        Vertex,
    },
    anyhow::Result,
    ash::vk::{self, Rect2D},
    std::{fmt, sync::Arc},
};

#[macro_export]
macro_rules! offset_of {
    ($base:path, $field:ident) => {{
        #[allow(unused_unsafe)]
        unsafe {
            let b: $base = std::mem::zeroed();
            std::ptr::addr_of!(b.$field) as isize - std::ptr::addr_of!(b) as isize
        }
    }};
}

pub struct Renderer {
    backend: Arc<RenderBackend>,
    // pub present_complete_semaphore: vk::Semaphore,
    // pub rendering_complete_semaphore: vk::Semaphore,
    // pub render_pass: Arc<RenderPass>,
    // pub framebuffers: Framebuffers,
    // pub pipeline: aleph_hal::vk::pipeline::Pipeline,
    // pub vertex_buffer: Buffer,
    // pub index_buffer: Buffer,
    // pub viewports: [vk::Viewport; 1],
    // pub scissors: [Rect2D; 1],
    // pub index_buffer_data: [u32; 3],
}

impl fmt::Debug for Renderer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Renderer").finish_non_exhaustive()
    }
}

impl Renderer {
    pub fn new(backend: Arc<RenderBackend>) -> Result<Self> {
        Ok(Renderer { backend })
    }

    pub fn render(&self) {}
}

// let present_complete_semaphore = backend.device.create_semaphore()?;
// let rendering_complete_semaphore = backend.device.create_semaphore()?;

// let framebuffers = backend
//     .device
//     .create_framebuffers(&backend.swapchain, &backend.render_pass)?;
// log::info!("Created framebuffers: {framebuffers:?}");

// let index_buffer_data = [0u32, 1, 2];
// let index_buffer = backend.device.create_buffer(
//     BufferDesc {
//         size: 3,
//         usage: BufferUsage::Index,
//         memory_location: MemoryLocation::CpuToGpu,
//     },
//     Some(&index_buffer_data),
// )?;
// log::info!("Created index buffer: {index_buffer:?}");

// let vertices = [
//     Vertex {
//         pos: [-1.0, 1.0, 0.0, 1.0],
//         color: [0.0, 1.0, 0.0, 1.0],
//     },
//     Vertex {
//         pos: [1.0, 1.0, 0.0, 1.0],
//         color: [0.0, 0.0, 1.0, 1.0],
//     },
//     Vertex {
//         pos: [0.0, -1.0, 0.0, 1.0],
//         color: [1.0, 0.0, 0.0, 1.0],
//     },
// ];
// let vertex_buffer = backend.device.create_buffer(
//     BufferDesc {
//         size: 3,
//         usage: BufferUsage::Vertex,
//         memory_location: MemoryLocation::CpuToGpu,
//     },
//     Some(&vertices),
// )?;
// log::info!("Created vertex buffer: {vertex_buffer:?}");

// let render_pass = backend.render_pass.clone();
// log::info!("Created default render pass: {render_pass:?}");

// let pipeline = Pipeline::create(&backend.device, &backend.swapchain, &render_pass)?;
// log::info!("Created default pipeline: {pipeline:?}");

// let viewports = [vk::Viewport {
//     x: 0.0,
//     y: 0.0,
//     width: backend.swapchain.desc.extent.width as f32,
//     height: backend.swapchain.desc.extent.height as f32,
//     min_depth: 0.0,
//     max_depth: 1.0,
// }];
// log::info!("Created viewports: {viewports:?}");
// let scissors = [backend.swapchain.desc.extent.into()];
// log::info!("Created scissors: {scissors:?}");

// Ok(Renderer {
//     backend,
//     render_pass,
//     framebuffers,
//     present_complete_semaphore,
//     rendering_complete_semaphore,
//     pipeline,
//     viewports,
//     scissors,
//     vertex_buffer,
//     index_buffer,
//     index_buffer_data,
// })

// unsafe {
//     let (present_index, _) = self
//         .backend
//         .swapchain
//         .fns
//         .acquire_next_image(
//             self.backend.swapchain.inner,
//             u64::MAX,
//             self.present_complete_semaphore,
//             vk::Fence::null(),
//         )
//         .unwrap();
//     let clear_values = [
//         vk::ClearValue {
//             color: vk::ClearColorValue {
//                 float32: [0.0, 0.0, 0.0, 0.0],
//             },
//         },
//         vk::ClearValue {
//             depth_stencil: vk::ClearDepthStencilValue {
//                 depth: 1.0,
//                 stencil: 0,
//             },
//         },
//     ];

//     let render_pass_begin_info = vk::RenderPassBeginInfo::default()
//         .render_pass(self.render_pass.inner)
//         .framebuffer(self.framebuffers[present_index as usize])
//         .render_area(self.backend.swapchain.desc.extent.into())
//         .clear_values(&clear_values);

//     self.backend.device.begin_command_buffer()?;
//     /*
//                 Ok(unsafe {
//         let fences = &[self.command_buffer_fence];
//         self.inner.wait_for_fences(fences, true, u64::MAX)?;
//         self.inner.reset_fences(fences)?;
//         self.inner.reset_command_buffer(
//             self.command_buffer.inner,
//             vk::CommandBufferResetFlags::RELEASE_RESOURCES,
//         )?;

//         let command_buffer_begin_info = vk::CommandBufferBeginInfo::default()
//             .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT);

//         self.inner
//             .begin_command_buffer(self.command_buffer.inner, &command_buffer_begin_info)?
//     })
//          */
//     let device = &self.backend.device.inner;
//     let command_buffer = self.backend.device.command_buffer.inner;
//     let submit_queue = self.backend.device.queue.inner;

//     let command_buffer_reuse_fence = self.backend.device.command_buffer_fence;
//     // device
//     //     .wait_for_fences(&[command_buffer_reuse_fence], true, u64::MAX)
//     //     .expect("Wait for fence failed.");

//     // device
//     //     .reset_fences(&[command_buffer_reuse_fence])
//     //     .expect("Reset fences failed.");

//     // device
//     //     .reset_command_buffer(
//     //         command_buffer,
//     //         vk::CommandBufferResetFlags::RELEASE_RESOURCES,
//     //     )
//     //     .expect("Reset command buffer failed.");

//     // let command_buffer_begin_info = vk::CommandBufferBeginInfo::default()
//     //     .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT);

//     // device
//     //     .begin_command_buffer(command_buffer, &command_buffer_begin_info)
//     //     .expect("Begin commandbuffer");
//     // // let device = &self.backend.device.inner;
//     // // let buffer = self.backend.device.command_buffer.inner;

//     device.cmd_begin_render_pass(
//         command_buffer,
//         &render_pass_begin_info,
//         vk::SubpassContents::INLINE,
//     );
//     device.cmd_bind_pipeline(
//         command_buffer,
//         vk::PipelineBindPoint::GRAPHICS,
//         self.pipeline.inner,
//     );
//     device.cmd_set_viewport(command_buffer, 0, &self.viewports);
//     device.cmd_set_scissor(command_buffer, 0, &self.scissors);
//     device.cmd_bind_vertex_buffers(command_buffer, 0, &[self.vertex_buffer.inner], &[0]);
//     device.cmd_bind_index_buffer(
//         command_buffer,
//         self.index_buffer.inner,
//         0,
//         vk::IndexType::UINT32,
//     );
//     device.cmd_draw_indexed(
//         command_buffer,
//         self.index_buffer_data.len() as u32,
//         1,
//         0,
//         0,
//         1,
//     );
//     device.cmd_end_render_pass(command_buffer);
//     device.end_command_buffer(command_buffer)?;
//     let wait_semaphores = &[self.rendering_complete_semaphore];
//     let signal_semaphores = &[self.present_complete_semaphore];
//     // device
//     //     .end_command_buffer(command_buffer)
//     //     .expect("End commandbuffer");

//     let command_buffers = vec![command_buffer];

//     let submit_info = vk::SubmitInfo::default()
//         .wait_semaphores(wait_semaphores)
//         .wait_dst_stage_mask(&[vk::PipelineStageFlags::COLOR_ATTACHMENT_OUTPUT])
//         .command_buffers(&command_buffers)
//         .signal_semaphores(signal_semaphores);

//     device
//         .queue_submit(submit_queue, &[submit_info], command_buffer_reuse_fence)
//         .expect("queue submit failed.");

//     // self.backend.device.end_command_buffer(
//     //     wait_semaphores,
//     //     signal_semaphores,
//     //     &[vk::PipelineStageFlags::COLOR_ATTACHMENT_OUTPUT],
//     // )?;

//     let swapchains = [self.backend.swapchain.inner];
//     let image_indices = [present_index];
//     let present_info = vk::PresentInfoKHR::default()
//         .wait_semaphores(wait_semaphores) // &base.rendering_complete_semaphore)
//         .swapchains(&swapchains)
//         .image_indices(&image_indices);

//     self.backend
//         .swapchain
//         .fns
//         .queue_present(self.backend.device.queue.inner, &present_info)
//         .unwrap();

//     Ok(())
//     // let command_buffers = vec![buffer];
//     // let signal_semaphores = [self.present_complete_semaphore];
//     // let wait_semaphores = [self.rendering_complete_semaphore];
//     // // let swapchains = [self.backend.swapchain.inner];
//     // // let image_indices = [present_index];

//     // let submit_info = vk::SubmitInfo::default()
//     //     .wait_semaphores(&wait_semaphores)
//     //     .wait_dst_stage_mask(&[])
//     //     .command_buffers(&command_buffers)
//     //     .signal_semaphores(&signal_semaphores);

//     // Ok(self.backend.device.inner.queue_submit(
//     //     self.backend.device.queue.inner,
//     //     &[submit_info],
//     //     self.backend.draw_commands_reuse_fence,
//     // )?)
//     // .unwrap();
//     // Ok(())
// }
