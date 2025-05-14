// TODO

pub use ash::vk::ImageLayout;
use {
    crate::{Buffer, Device, Image, PipelineBindPoint, Queue},
    anyhow::Result,
    ash::{
        vk,
        vk::{CommandBufferResetFlags, Handle, SemaphoreSubmitInfo},
    },
    bytemuck::Pod,
    core::slice,
    derive_more::{Debug, Deref},
};

#[derive(Clone, Debug, Deref)]
pub struct CommandPool {
    #[deref]
    pub(crate) handle: vk::CommandPool,
    #[debug("{:x}", queue.handle.as_raw())]
    pub(crate) queue: Queue,
    #[debug("{:x}", device.handle.handle().as_raw())]
    pub(crate) device: Device,
}

impl CommandPool {
    pub fn handle(&self) -> vk::CommandPool { self.handle }

    pub fn create_command_buffer(&self) -> CommandBuffer {
        let info = vk::CommandBufferAllocateInfo::default()
            .command_buffer_count(1)
            .command_pool(**self)
            .level(vk::CommandBufferLevel::PRIMARY);

        unsafe {
            self.device
                .handle
                .allocate_command_buffers(&info)
                .map(|buffers| CommandBuffer {
                    handle: buffers[0],
                    queue: self.queue.clone(),
                    fence: None,
                    wait_semaphore_infos: Vec::new(),
                    signal_semaphore_infos: Vec::new(),
                    command_buffer_infos: vec![
                        vk::CommandBufferSubmitInfo::default().command_buffer(buffers[0])
                    ],
                })
                .unwrap_or_else(|e| panic!("Error allocating command buffer {:?}: {:?}", **self, e))
        }
    }
}

#[derive(Clone, Debug, Deref)]
pub struct CommandBuffer {
    #[deref]
    #[debug("{:x}", handle.as_raw())]
    handle: vk::CommandBuffer,
    #[debug("{:x}", queue.handle.as_raw())]
    pub(crate) queue: Queue,
    pub(crate) wait_semaphore_infos: Vec<vk::SemaphoreSubmitInfo<'static>>,
    pub(crate) signal_semaphore_infos: Vec<vk::SemaphoreSubmitInfo<'static>>,
    pub(crate) command_buffer_infos: Vec<vk::CommandBufferSubmitInfo<'static>>,
    pub(crate) fence: Option<vk::Fence>,
}
unsafe impl Sync for CommandBuffer {}
unsafe impl Send for CommandBuffer {}
impl CommandBuffer {
    pub fn handle(&self) -> vk::CommandBuffer { self.handle }

    pub fn queue(&self) -> &Queue { &self.queue }

    pub fn submit_info(&self) -> vk::SubmitInfo2 {
        vk::SubmitInfo2::default()
            .wait_semaphore_infos(&self.wait_semaphore_infos)
            .signal_semaphore_infos(&self.signal_semaphore_infos)
            .command_buffer_infos(&self.command_buffer_infos)
    }

    pub fn signal_semaphore(&mut self, semaphore: vk::Semaphore) {
        self.signal_semaphore_infos.push(
            vk::SemaphoreSubmitInfo::default()
                .semaphore(semaphore)
                .stage_mask(vk::PipelineStageFlags2::ALL_COMMANDS),
        );
    }

    pub fn fence(&mut self, fence: vk::Fence) { self.fence = Some(fence); }

    pub fn wait_semaphore(&mut self, semaphore: vk::Semaphore) {
        self.wait_semaphore_infos.push(
            vk::SemaphoreSubmitInfo::default()
                .semaphore(semaphore)
                .stage_mask(vk::PipelineStageFlags2::ALL_COMMANDS),
        );
    }

    pub fn record<'a>(&'a self, device: &'a Device) -> CommandRecorder<'a> {
        self.reset(device);
        self.begin(device);

        CommandRecorder {
            handle: self,
            device,
        }
    }

    fn reset(&self, device: &Device) {
        unsafe {
            device
                .handle
                .reset_command_buffer(**self, CommandBufferResetFlags::RELEASE_RESOURCES)
                .unwrap_or_else(|e| panic!("Error resetting command buffer {:?}: {:?}", self, e))
        }
    }

    fn begin(&self, device: &Device) {
        let info = vk::CommandBufferBeginInfo::default()
            .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT);

        unsafe {
            device
                .handle
                .begin_command_buffer(**self, &info)
                .unwrap_or_else(|e| panic!("Error beginning command buffer {:?}: {:?}", self, e))
        }
    }
}

#[derive(Deref, Debug)]
pub struct CommandRecorder<'a> {
    #[deref]
    #[debug("{:x}", handle.as_raw())]
    handle: &'a CommandBuffer,
    #[debug("{:x}", device.handle.handle().as_raw())]
    device: &'a Device,
}

impl<'a> CommandRecorder<'a> {
    pub fn end(&self) {
        unsafe {
            self.device
                .handle
                .end_command_buffer(**self.handle)
                .unwrap_or_else(|e| panic!("Error ending command buffer {:?}: {:?}", **self, e))
        }
    }

    pub fn reset(&self) {
        #[allow(clippy::unit_arg)]
        unsafe {
            self.device
                .handle
                .reset_command_buffer(
                    **self.handle,
                    vk::CommandBufferResetFlags::RELEASE_RESOURCES,
                )
                .unwrap_or_else(|e| panic!("Error resetting command buffer {:?}: {:?}", **self, e))
        }
    }

    pub fn begin_rendering(
        &self,
        color_attachments: &[vk::RenderingAttachmentInfo],
        depth_attachment: Option<&vk::RenderingAttachmentInfo>,
        extent: vk::Extent2D,
    ) {
        let mut rendering_info = vk::RenderingInfo::default()
            .render_area(vk::Rect2D {
                offset: vk::Offset2D { x: 0, y: 0 },
                extent,
            })
            .layer_count(1)
            .color_attachments(color_attachments);

        if let Some(depth_attachment) = depth_attachment {
            rendering_info = rendering_info.depth_attachment(depth_attachment);
        }

        unsafe {
            self.device
                .handle
                .cmd_begin_rendering(**self.handle, &rendering_info)
        }
    }

    pub fn draw(
        &self,
        vertex_count: u32,
        instance_count: u32,
        first_vertex: u32,
        first_instance: u32,
    ) {
        unsafe {
            self.device.handle.cmd_draw(
                **self.handle,
                vertex_count,
                instance_count,
                first_vertex,
                first_instance,
            )
        }
    }

    pub fn draw_indexed(
        &self,
        index_count: u32,
        instance_count: u32,
        first_index: u32,
        vertex_offset: i32,
        first_instance: u32,
    ) {
        unsafe {
            self.device.handle.cmd_draw_indexed(
                **self.handle,
                index_count,
                instance_count,
                first_index,
                vertex_offset,
                first_instance,
            )
        }
    }

    pub fn end_rendering(&self) -> Result<()> {
        Ok(unsafe { self.device.handle.cmd_end_rendering(**self.handle) })
    }

    pub fn bind_vertex_buffer(&self, buffer: &Buffer, _offset: u64) {
        unsafe {
            self.device
                .handle
                .cmd_bind_vertex_buffers(**self.handle, 0, &[buffer.handle()], &[0]);
        }
    }

    pub fn bind_index_buffer(&self, buffer: &Buffer, offset: u64) {
        unsafe {
            self.device.handle.cmd_bind_index_buffer(
                **self.handle,
                buffer.handle(),
                offset,
                vk::IndexType::UINT32,
            );
        }
    }

    pub fn bind_pipeline(
        &self,
        pipeline_bind_point: vk::PipelineBindPoint,
        pipeline: vk::Pipeline,
    ) {
        unsafe {
            self.device
                .handle
                .cmd_bind_pipeline(**self.handle, pipeline_bind_point, pipeline);
        }
    }

    pub fn bind_descriptor_sets(
        &self,
        layout: vk::PipelineLayout,
        first_set: u32,
        sets: &[vk::DescriptorSet],
        offsets: &[u32],
    ) {
        unsafe {
            self.device.handle.cmd_bind_descriptor_sets(
                **self.handle,
                PipelineBindPoint::GRAPHICS,
                layout,
                first_set,
                sets,
                offsets,
            );
        }
    }

    pub fn update_descriptor_set(
        &self,
        writes: &[vk::WriteDescriptorSet],
        copies: &[vk::CopyDescriptorSet],
    ) {
        unsafe {
            self.device.handle.update_descriptor_sets(writes, copies);
        }
    }

    pub fn push_constants<T: Pod>(
        &self,
        layout: vk::PipelineLayout,
        stage_flags: vk::ShaderStageFlags,
        offset: u32,
        data: &T,
    ) {
        let data: &[T] = slice::from_ref(data);

        unsafe {
            self.device.handle.cmd_push_constants(
                **self.handle,
                layout,
                stage_flags,
                offset,
                bytemuck::cast_slice(data),
            );
        }
    }

    pub fn set_scissor(&self, scissor: vk::Rect2D) {
        unsafe {
            self.device
                .handle
                .cmd_set_scissor(**self.handle, 0, &[scissor]);
        }
    }

    pub fn set_viewport(&self, viewport: vk::Viewport) {
        unsafe {
            self.device
                .handle
                .cmd_set_viewport(**self.handle, 0, &[viewport]); //std::slice::from_ref(&
        }
    }

    pub fn set_line_width(&self, width: f32) {
        unsafe { self.device.handle.cmd_set_line_width(**self.handle, width) }
    }

    pub fn copy_image(
        &self,
        src: &Image,
        dst: &Image,
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
            .src_image(src.handle())
            .src_image_layout(vk::ImageLayout::TRANSFER_SRC_OPTIMAL)
            .dst_image(dst.handle())
            .dst_image_layout(vk::ImageLayout::TRANSFER_DST_OPTIMAL)
            .regions(regions);

        unsafe {
            self.device
                .handle
                .cmd_blit_image2(**self.handle, &blit_info)
        }
    }

    pub fn copy_buffer(&self, src: &Buffer, dst: &Buffer, size: u64) {
        let copy = vk::BufferCopy::default().size(size);
        unsafe {
            self.device
                .handle
                .cmd_copy_buffer(**self.handle, src.handle(), dst.handle(), &[copy])
        };
    }

    pub fn copy_buffer_to_image(&self, src: &Buffer, dst: &Image) {
        let copy = vk::BufferImageCopy::default()
            .buffer_offset(0)
            .buffer_row_length(0)
            .buffer_image_height(0)
            .image_subresource(
                vk::ImageSubresourceLayers::default()
                    .aspect_mask(vk::ImageAspectFlags::COLOR)
                    .layer_count(1),
            )
            .image_offset(vk::Offset3D::default())
            .image_extent(dst.extent().into());

        unsafe {
            self.device.handle.cmd_copy_buffer_to_image(
                **self.handle,
                src.handle(),
                dst.handle(),
                vk::ImageLayout::TRANSFER_DST_OPTIMAL,
                &[copy],
            );
        }
    }

    pub fn pipeline_barrier(
        &self,
        memory_barriers: &[vk::MemoryBarrier2],
        buffer_barriers: &[vk::BufferMemoryBarrier2],
        image_barriers: &[vk::ImageMemoryBarrier2],
    ) {
        unsafe {
            self.device.handle.cmd_pipeline_barrier2(
                **self.handle,
                &vk::DependencyInfo::default()
                    .memory_barriers(memory_barriers)
                    .buffer_memory_barriers(buffer_barriers)
                    .image_memory_barriers(image_barriers),
            )
        };
    }

    #[deprecated]
    pub fn transition_image(
        &self,
        image: &Image,
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
            .image(image.handle())
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
                .handle
                .cmd_pipeline_barrier2(**self.handle, &dependency_info);
        }
    }
}

impl Drop for CommandRecorder<'_> {
    fn drop(&mut self) { self.end() }
}

#[cfg(test)]
mod tests {
    use {super::*, crate::Gpu};

    #[test]
    fn test_create_command_pool() {
        let gpu = Gpu::headless().unwrap();
        let queue = gpu.device.graphics_queue;
        let pool = gpu.device.create_command_pool(&queue).unwrap();

        assert_ne!(pool.handle(), vk::CommandPool::null());
    }

    #[test]
    fn test_create_command_buffer() {
        let gpu = Gpu::headless().unwrap();
        let queue = gpu.device.graphics_queue;
        let pool = gpu.device.create_command_pool(&queue).unwrap();
        let command_buffer = pool.create_command_buffer();

        assert_ne!(command_buffer.handle(), vk::CommandBuffer::null());
    }

    #[test]
    fn test_create_command_recorder() {
        let gpu = Gpu::headless().unwrap();
        let queue = gpu.device.graphics_queue;
        let pool = gpu.device.create_command_pool(&queue).unwrap();
        let command_buffer = pool.create_command_buffer();
        let command_recorder = command_buffer.record(&gpu.device);

        assert_ne!(**command_recorder.handle, vk::CommandBuffer::null());
    }

    #[test]
    fn test_command_recorder_open_reset_close() {
        let gpu = Gpu::headless().unwrap();
        let queue = gpu.device.graphics_queue;
        let pool = gpu.device.create_command_pool(&queue).unwrap();
        let command_buffer = pool.create_command_buffer();
        let command_recorder = command_buffer.record(&gpu.device);
        command_recorder.reset();
        command_recorder.end();
    }
}
