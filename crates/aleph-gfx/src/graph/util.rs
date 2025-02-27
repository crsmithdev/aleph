pub use ash::vk::{
    AttachmentLoadOp, AttachmentStoreOp, DescriptorSetLayoutBinding, ShaderStageFlags,
};
use bytemuck::Pod;
use crate::{vk::Gpu, Vertex};

use {
    crate::vk::Image,
    crate::vk::buffer::*,
    anyhow::Result,
    ash::{
        vk,
        vk::{ClearDepthStencilValue, ClearValue},
    },
};

pub fn index_buffer(gpu: &Gpu, size: u64, label: impl Into<String>) -> Result<Buffer<u32>> {
    Buffer::new(
        gpu.device(),
        gpu.allocator(),
        size,
        vk::BufferUsageFlags::INDEX_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
        MemoryLocation::GpuOnly,
        label,
    )
}

pub fn vertex_buffer(gpu: &Gpu, size: u64, label: impl Into<String>) -> Result<Buffer<Vertex>> {
    Buffer::new(
        gpu.device(),
        gpu.allocator(),
        size,
        vk::BufferUsageFlags::VERTEX_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
        MemoryLocation::GpuOnly ,
        label,
    )
}

pub fn staging_buffer<T: Pod>(gpu: &Gpu, data: &[T], label: impl Into<String>) -> Result<Buffer<T>> {
    Buffer::from_data(gpu.device(), gpu.allocator(), data, vk::BufferUsageFlags::TRANSFER_SRC, MemoryLocation::GpuToCpu, label)
}

pub fn color_attachment<'a>(image: &Image) -> vk::RenderingAttachmentInfo<'a> {
    vk::RenderingAttachmentInfo::default()
        .image_view(image.view)
        .image_layout(vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL)
        .load_op(AttachmentLoadOp::CLEAR)
        .store_op(AttachmentStoreOp::STORE)
}

pub fn depth_attachment<'a>(image: &Image) -> vk::RenderingAttachmentInfo<'a> {
    vk::RenderingAttachmentInfo::default()
        .image_view(image.view)
        .image_layout(vk::ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL)
        .clear_value(ClearValue {
            depth_stencil: ClearDepthStencilValue {
                depth: 1.0,
                stencil: 0,
            },
        })
        .load_op(AttachmentLoadOp::CLEAR)
        .store_op(AttachmentStoreOp::DONT_CARE)
}
