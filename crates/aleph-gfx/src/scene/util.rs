use {
    crate::{
        vk::{
            buffer::*, AttachmentLoadOp, AttachmentStoreOp, BufferUsageFlags,
            ClearDepthStencilValue, ClearValue, Format, Gpu, ImageAspectFlags, ImageLayout,
            ImageUsageFlags, RenderingAttachmentInfo, Texture,
        },
        Vertex,
    },
    anyhow::Result,
    ash::vk::{ClearColorValue, Extent2D},
    bytemuck::Pod, image::EncodableLayout,
};

pub fn single_color_image(
    gpu: &Gpu,
    pixel: [f32; 4],
    label: impl Into<String>,
) -> Result<Texture> {
    let extent = Extent2D {
        width: 1,
        height: 1,
    };
    let pixels = &[pixel];
    let data = bytemuck::bytes_of(pixels);
    let image = gpu.create_image(
        extent,
        Format::R8G8B8A8_SRGB,
        ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
        ImageAspectFlags::COLOR,
        label.into(),
    )?;

    let staging = staging_buffer(gpu, &data, "staging")?;
    gpu.execute(|cmd| {
        cmd.copy_buffer_to_image(&staging, &image);
        cmd.transition_image(
            &image,
            ImageLayout::UNDEFINED,
            ImageLayout::SHADER_READ_ONLY_OPTIMAL,
        );
    })?;

    Ok(image)
}

pub fn index_buffer(gpu: &Gpu, size: u64, label: impl Into<String>) -> Result<Buffer<u32>> {
    Buffer::new(
        gpu.device(),
        gpu.allocator(),
        size,
        BufferUsageFlags::INDEX_BUFFER | BufferUsageFlags::TRANSFER_DST,
        MemoryLocation::GpuOnly,
        label,
    )
}

pub fn vertex_buffer(gpu: &Gpu, size: u64, label: impl Into<String>) -> Result<Buffer<Vertex>> {
    Buffer::new(
        gpu.device(),
        gpu.allocator(),
        size,
        BufferUsageFlags::VERTEX_BUFFER | BufferUsageFlags::TRANSFER_DST,
        MemoryLocation::GpuOnly,
        label,
    )
}

pub fn staging_buffer<T: Pod>(
    gpu: &Gpu,
    data: &[T],
    label: impl Into<String>,
) -> Result<Buffer<T>> {
    let buffer = Buffer::from_data(
        gpu.device(),
        gpu.allocator(),
        data,
        BufferUsageFlags::TRANSFER_SRC,
        MemoryLocation::GpuToCpu,
        label,
    )?;
    Ok(buffer)
}

pub fn color_attachment<'a>(image: &Texture) -> RenderingAttachmentInfo<'a> {
    RenderingAttachmentInfo::default()
        .clear_value(ClearValue {
            color: ClearColorValue {
                float32: [0.5, 0.5, 0.5, 1.0],
            },
        })
        .image_view(image.view())
        .image_layout(ImageLayout::COLOR_ATTACHMENT_OPTIMAL)
        .load_op(AttachmentLoadOp::CLEAR)
        .store_op(AttachmentStoreOp::STORE)
}

pub fn depth_attachment<'a>(image: &Texture) -> RenderingAttachmentInfo<'a> {
    RenderingAttachmentInfo::default()
        .image_view(image.view())
        .image_layout(ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL)
        .clear_value(ClearValue {
            depth_stencil: ClearDepthStencilValue {
                depth: 1.0,
                stencil: 0,
            },
        })
        .load_op(AttachmentLoadOp::CLEAR)
        .store_op(AttachmentStoreOp::DONT_CARE)
}

pub fn rgb_to_rgba(data_rgb: &[u8], extent: Extent2D) -> Vec<u8> {
    let image = image::DynamicImage::ImageRgb8(
        image::ImageBuffer::from_raw(extent.width, extent.height, data_rgb.to_vec())
            .expect("raw"));
    let dest = image.to_rgba8();
    dest.as_bytes().to_vec()
}
