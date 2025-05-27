pub use ash::vk::ImageLayout;
use {
    crate::{Buffer, Device, Image, Queue},
    ash::{
        vk,
        vk::{Handle, PipelineBindPoint},
    },
    bytemuck::Pod,
    core::slice,
    derive_more::{Debug, Deref},
};

#[derive(Clone, Debug, Deref)]
pub struct CommandPool {
    name: String,
    #[deref]
    handle: ash::vk::CommandPool,
    queue: Queue,
    #[debug(skip)]
    device: Device,
}

impl CommandPool {
    pub fn new(device: &Device, queue: &Queue, name: &str) -> CommandPool {
        let handle = device.create_command_pool(queue);
        let pool = CommandPool {
            name: name.to_string(),
            queue: queue.clone(),
            handle,
            device: device.clone(),
        };

        log::trace!("Created {pool:?}");
        pool
    }

    pub fn handle(&self) -> vk::CommandPool { self.handle }

    pub fn create_command_buffer(&self, name: &str) -> CommandBuffer {
        let handle = self.device.create_command_buffers(&**self, 1)[0];
        let cmd = CommandBuffer {
            handle,
            pool: **self,
            device: self.device.clone(),
            name: name.to_string(),
        };

        log::trace!("Created {cmd:?}");
        cmd
    }

    pub fn queue(&self) -> &Queue { &self.queue }

    pub fn queue_family_index(&self) -> u32 { self.queue.family.index() }

    pub fn name(&self) -> &str { &self.name }
}

#[allow(dead_code)]
#[derive(Debug, Deref)]
pub struct CommandBuffer {
    name: String,
    #[deref]
    #[debug("{:#x}", handle.as_raw())]
    pub(crate) handle: vk::CommandBuffer,
    #[debug("{:#x}", pool.as_raw())]
    pub(crate) pool: vk::CommandPool,
    #[debug(skip)]
    pub(crate) device: Device,
}

impl CommandBuffer {
    pub fn handle(&self) -> vk::CommandBuffer { self.handle }

    pub fn reset(&self) {
        log::trace!("Resetting {self:?}");
        unsafe {
            self.device
                .handle
                .reset_command_buffer(self.handle, vk::CommandBufferResetFlags::RELEASE_RESOURCES)
                .unwrap_or_else(|e| panic!("Failed to reset {self:?}: {e:?}"))
        }
    }

    pub fn begin(&self) {
        log::trace!("Beginning {self:?}");
        let info = vk::CommandBufferBeginInfo::default()
            .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT);

        unsafe {
            self.device
                .handle
                .begin_command_buffer(self.handle, &info)
                .unwrap_or_else(|e| panic!("Failed to begin {self:?}: {e:?}"))
        }
    }

    pub fn end(&self) {
        log::trace!("Ending {self:?}");
        unsafe {
            self.device
                .handle
                .end_command_buffer(self.handle)
                .unwrap_or_else(|e| panic!("Failed to end {self:?}: {e:?}"))
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
                self.handle,
                &vk::DependencyInfo::default()
                    .memory_barriers(memory_barriers)
                    .buffer_memory_barriers(buffer_barriers)
                    .image_memory_barriers(image_barriers),
            )
        };
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
                self.handle,
                layout,
                stage_flags,
                offset,
                bytemuck::cast_slice(data),
            );
        }
    }
    pub fn begin_rendering(
        &self,
        color_attachments: &[vk::RenderingAttachmentInfo],
        depth_attachment: Option<&vk::RenderingAttachmentInfo>,
        extent: vk::Extent2D,
    ) {
        log::trace!("Begin rendering in {self:?}");
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

        #[allow(clippy::unit_arg)]
        unsafe {
            self.device.handle.cmd_begin_rendering(self.handle, &rendering_info)
        }
    }

    pub fn end_rendering(&self) {
        log::trace!("End rendering in {self:?}");
        unsafe { self.device.handle.cmd_end_rendering(self.handle) }
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
                self.handle,
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
                self.handle,
                index_count,
                instance_count,
                first_index,
                vertex_offset,
                first_instance,
            )
        }
    }

    pub fn bind_vertex_buffer(&self, buffer: &Buffer, _offset: u64) {
        unsafe {
            self.device.handle.cmd_bind_vertex_buffers(self.handle, 0, &[buffer.handle()], &[0]);
        }
    }

    pub fn bind_index_buffer(&self, buffer: &Buffer, offset: u64) {
        unsafe {
            self.device.handle.cmd_bind_index_buffer(
                self.handle,
                buffer.handle(),
                offset,
                vk::IndexType::UINT32,
            );
        }
    }

    pub fn set_scissor(&self, scissor: vk::Rect2D) {
        unsafe {
            self.device.handle.cmd_set_scissor(self.handle, 0, &[scissor]);
        }
    }

    pub fn set_viewport(&self, viewport: vk::Viewport) {
        unsafe {
            self.device.handle.cmd_set_viewport(self.handle, 0, &[viewport]); //std::slice::from_ref(&
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
                self.handle,
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

    pub fn bind_pipeline(
        &self,
        pipeline_bind_point: vk::PipelineBindPoint,
        pipeline: vk::Pipeline,
    ) {
        unsafe { self.device.handle.cmd_bind_pipeline(self.handle, pipeline_bind_point, pipeline) }
    }

    pub fn dispatch(&self, group_count_x: u32, group_count_y: u32, group_count_z: u32) {
        unsafe {
            self.device.handle.cmd_dispatch(
                self.handle,
                group_count_x,
                group_count_y,
                group_count_z,
            )
        }
    }

    pub fn set_line_width(&self, width: f32) {
        unsafe { self.device.handle.cmd_set_line_width(self.handle, width) }
    }

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
            self.device.handle.cmd_pipeline_barrier2(self.handle, &dependency_info);
        }
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
            vk::Offset3D::default().x(src_extent.width as i32).y(src_extent.height as i32).z(1),
        ];
        let dst_offsets = [
            vk::Offset3D::default(),
            vk::Offset3D::default().x(dst_extent.width as i32).y(dst_extent.height as i32).z(1),
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

        unsafe { self.device.handle.cmd_blit_image2(self.handle, &blit_info) }
    }

    pub fn copy_buffer(&self, src: &Buffer, dst: &Buffer, size: u64) {
        let copy = vk::BufferCopy::default().size(size);
        unsafe {
            self.device
                .handle
                .cmd_copy_buffer(self.handle(), src.handle(), dst.handle(), &[copy])
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
                self.handle(),
                src.handle(),
                dst.handle(),
                vk::ImageLayout::TRANSFER_DST_OPTIMAL,
                &[copy],
            );
        };
    }
}

impl Drop for CommandBuffer {
    fn drop(&mut self) {
        log::trace!("Dropped {self:?}");
    }
}
