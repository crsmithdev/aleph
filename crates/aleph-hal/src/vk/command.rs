use {
    crate::{
        Allocator,
        Buffer,
        BufferInfo,
        BufferUsageFlags,
        DeletionQueue,
        Device,
        Image,
        MemoryLocation,
    },
    anyhow::Result,
    ash::vk::{self, Extent3D},
    bytemuck::Pod,
    derive_more::{Debug, Deref},
    serde::Serialize,
    std::{any::Any, sync::Arc},
};
pub use ash::vk::ImageLayout;

#[derive(Clone, Debug)]
pub struct CommandPool {
    pub(crate) handle: vk::CommandPool,
    pub(crate) device: crate::Device,
}

impl CommandPool {
    pub fn handle(&self) -> vk::CommandPool {
        self.handle
    }

    pub fn create_command_buffer(&self) -> Result<CommandBuffer> {
        CommandBuffer::new(&self.device, self)
    }
}

#[allow(dead_code)]
#[derive(Debug, Deref)]
pub struct CommandBuffer {
    #[deref]
    pub(crate) handle: vk::CommandBuffer,
    pub(crate) pool: vk::CommandPool,
    pub(crate) device: Device,
    pub(crate) fence: vk::Fence,
    to_release: Vec<Box<dyn Any>>,
}

impl CommandBuffer {
    pub fn new(device: &Device, pool: &CommandPool) -> Result<CommandBuffer> {
        let handle = device.allocate_command_buffer(pool.handle, 1)?;
        let fence = device.create_fence_signaled()?;

        Ok(CommandBuffer {
            handle,
            pool: pool.handle,
            device: device.clone(),
            to_release: Vec::new(),
            fence,
        })
    }
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

    pub fn begin_rendering(
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

        if let Some(depth_attachment) = depth_attachment {
            rendering_info = rendering_info.depth_attachment(depth_attachment);
        }

        #[allow(clippy::unit_arg)]
        Ok(unsafe {
            self.device
                .cmd_begin_rendering(self.handle, &rendering_info)
        })
    }

    pub fn end_rendering(&self) -> Result<()> {
        #[allow(clippy::unit_arg)]
        Ok(unsafe { self.device.handle.cmd_end_rendering(self.handle) })
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

    pub fn draw_indexed(
        &self,
        index_count: u32,
        instance_count: u32,
        first_index: u32,
        vertex_offset: i32,
        first_instance: u32,
    ) {
        unsafe {
            self.device.cmd_draw_indexed(
                self.handle,
                index_count,
                instance_count,
                first_index,
                vertex_offset,
                first_instance,
            )
        }
    }

    pub fn bind_vertex_buffer(&self, buffer: &Buffer, offset: u64) {
        unsafe {
            self.device.handle
                .cmd_bind_vertex_buffers(self.handle, 0, &[buffer.handle], &[0]);
        }
    }

    pub fn bind_index_buffer(&self, buffer: &Buffer, offset: u64) {
        unsafe {
            self.device.handle
                .cmd_bind_index_buffer(self.handle, buffer.handle, offset, vk::IndexType::UINT32);
        }
    }

    pub fn set_scissor(&self, scissor: vk::Rect2D) {
        unsafe {
            self.device.cmd_set_scissor(self.handle, 0, &[scissor]);
        }
    }

    pub fn set_viewport(&self, viewport: vk::Viewport) {
        unsafe {
            self.device.cmd_set_viewport(self.handle, 0, &[viewport]); //std::slice::from_ref(&
        }
    }

    pub fn push_constants<T: serde::Serialize + bytemuck::Pod>(
        &self,
        layout: vk::PipelineLayout,
        data: &T,
    ) {
        let data: &[u8] = bytemuck::bytes_of(data);

        unsafe {
            self.device.cmd_push_constants(
                self.handle,
                layout,
                vk::ShaderStageFlags::VERTEX,
                0,
                data,
            );
        }
    }

    pub fn push_descriptor_sets(
        &self,
        bind_point: vk::PipelineBindPoint,
        layout: vk::PipelineLayout,
        sets: &[vk::WriteDescriptorSet],
    ) {
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

    pub fn submit_immediate(&self, f: impl FnOnce(&CommandBuffer)) -> Result<()> {
        // self.device.wait_for_fence(self.fence)?;
        // self.device.reset_fence(self.fence)?;
        // self.reset()?;
        // self.begin()?;

        f(self);

        // self.end()?;

        let command_buffer_info = &[vk::CommandBufferSubmitInfo::default()
            .command_buffer(self.handle)
            .device_mask(0)];
        let submit_info = &[vk::SubmitInfo2::default()
            .command_buffer_infos(command_buffer_info)
            .wait_semaphore_infos(&[])
            .signal_semaphore_infos(&[])];

        let result = Ok(unsafe {
            self.device
                .queue_submit2(self.device.queue.handle, submit_info, vk::Fence::null())//self.fence)
        }?);
        unsafe { self.device.handle.device_wait_idle().unwrap() };
        result
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
            .image(image.handle)
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
            .src_image(src.handle)
            .src_image_layout(vk::ImageLayout::TRANSFER_SRC_OPTIMAL)
            .dst_image(dst.handle)
            .dst_image_layout(vk::ImageLayout::TRANSFER_DST_OPTIMAL)
            // .filter(vk::Filter::Linear)
            .regions(regions);

        unsafe { self.device.cmd_blit_image2(self.handle, &blit_info) }
    }

    pub fn copy_buffer(&self, src: &Buffer, dst: &Buffer, size: u64) {
        let copy = vk::BufferCopy::default().size(size);
        unsafe {
            self.device
                .handle
                .cmd_copy_buffer(self.handle(), src.handle(), dst.handle(), &[copy])
        };
    }

    pub fn upload_buffer<T: Serialize + Pod>(&self, buffer: &Buffer, data: &[T]) -> Result<()> {
        let data: &[u8] = bytemuck::cast_slice(data);
        let size = data.len();


        let staging: Buffer = Buffer::new(
            buffer.allocator.clone(),
            &self.device,
            BufferInfo {
                usage: BufferUsageFlags::TRANSFER_SRC,
                location: MemoryLocation::CpuToGpu,
                size,
                label: Some("staging"),
            },
        )?;
        staging.write(data);

        // self.submit_immediate(|_| {
            self.copy_buffer(&staging, buffer, size as u64);
        // })?;

        // self.deletion_queue.enqueue(staging);
        // self.to_release.push(Box::new(staging));

        // staging.destroy();
        Ok(())
    }

    pub fn upload_image(
        &self,
        image: &Image,
        data: &[u8],
    ) -> Result<()> {
        let size = data.len();
         let extent = Extent3D {
            width: image.info.extent.width,
            height: image.info.extent.height,
            depth: 1,
        };

        let allocator = image.allocator.as_ref().unwrap();
        let staging: Buffer = Buffer::new(
            Arc::clone(allocator),
            &self.device,
            BufferInfo {
                usage: BufferUsageFlags::TRANSFER_SRC,
                location: MemoryLocation::CpuToGpu,
                size,
                label: Some("staging"),
            },
        )?;
        // // // // dbg!(size);
        // // // dbg!(data.len());
        // // dbg!(data);
        // dbg!(staging.info.size);
        staging.write(data); 
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
            .image_extent(extent);

        // self.submit_immediate(|_| {
            self.transition_image(
                image,
                ImageLayout::UNDEFINED,
                ImageLayout::TRANSFER_DST_OPTIMAL,
            );
            unsafe {
                self.device.cmd_copy_buffer_to_image(
                    self.handle,
                    staging.handle,
                    image.handle,
                    vk::ImageLayout::TRANSFER_DST_OPTIMAL,
                    &[copy],
                )
            };
            self.transition_image(
                image,
                ImageLayout::TRANSFER_DST_OPTIMAL,
                ImageLayout::SHADER_READ_ONLY_OPTIMAL,
            );
        // })?;
        // self.deletion_queue.enqueue(staging);
        // self.to_release.push(Box::new(staging));

        Ok(())
    }

    fn release_resources(&mut self, queue: &mut DeletionQueue) {
            let to_release = std::mem::take(&mut self.to_release);
            for resource in to_release {
                queue.enqueue(resource);
            }
        }

    // pub fn copy_buffer_to_image(
    //     &self,
    //     src: &Buffer,
    //     dst: &Image,
    //     format: vk::Format,
    //     region: &vk::BufferImageCopy,
    // ) {
    //     unsafe {
    //         self.device
    //             .handle
    //             .cmd_copy_buffer_to_image(self.handle(), src.handle(), dst.handle(), region)
    //     };
    // }
}
