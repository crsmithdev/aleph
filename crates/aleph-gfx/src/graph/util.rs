use {
    crate::{
        vk::{
            buffer::*, Format, ImageAspectFlags, ImageUsageFlags, AttachmentLoadOp, AttachmentStoreOp, BufferUsageFlags,
            ClearDepthStencilValue, ClearValue, Gpu, ImageLayout, RenderingAttachmentInfo, Texture,
        },
        Vertex,
    }, anyhow::Result, ash::vk::Extent2D, bytemuck::Pod, image
};

pub fn single_color_image(gpu: &Gpu, pixel: [f32; 4]) -> Result<Texture> {
    let created = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        1,
        1,
        image::Rgba::<u8>::from([
            (pixel[0] * 255.0) as u8,
            (pixel[1] * 255.0) as u8,
            (pixel[2] * 255.0) as u8,
            (pixel[3] * 255.0) as u8,
        ]),
    ))
    .into_rgba8();
    let extent = Extent2D {
        width: created.width(),
        height: created.height(),
    };
    let image = gpu.create_image(
        extent,
        Format::R8G8B8A8_UNORM,
        ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
        ImageAspectFlags::COLOR,
        "single color",
    )?;
    
        let staging = staging_buffer(gpu, created.as_raw(), "staging")?;
    gpu.execute(|cmd| {
        cmd.copy_buffer_to_image(&staging, &image);//, dst);
        // cmd.transition_image(&image, ImageLayout::UNDEFINED, ImageLayout::SHADER_READ_ONLY_OPTIMAL);
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
    Buffer::from_data(
        gpu.device(),
        gpu.allocator(),
        data,
        BufferUsageFlags::TRANSFER_SRC,
        MemoryLocation::GpuToCpu,
        label,
    )
}

pub fn color_attachment<'a>(image: &Texture) -> RenderingAttachmentInfo<'a> {
    RenderingAttachmentInfo::default()
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
