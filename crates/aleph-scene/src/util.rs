use {
    crate::Vertex,
    aleph_vk::{
        AttachmentLoadOp, AttachmentStoreOp, Buffer, BufferUsageFlags, ClearDepthStencilValue,
        ClearValue, Gpu, ImageLayout, MemoryLocation, RenderingAttachmentInfo, Texture,
    },
    anyhow::Result,
    ash::vk::{self, ClearColorValue, Extent2D},
    bytemuck::Pod,
    image::EncodableLayout,
};

pub fn default_sampler(gpu: &Gpu) -> Result<vk::Sampler> {
    gpu.create_sampler(
        vk::Filter::LINEAR,
        vk::Filter::LINEAR,
        vk::SamplerMipmapMode::LINEAR,
        vk::SamplerAddressMode::REPEAT,
        vk::SamplerAddressMode::REPEAT,
    )
}

// pub fn index_buffer(gpu: &Gpu, size: u64, label: impl Into<String>) -> Result<Buffer<u32>> {
//     Buffer::new(
//         gpu.device(),
//         gpu.allocator(),
//         size,
//         BufferUsageFlags::INDEX_BUFFER | BufferUsageFlags::TRANSFER_DST,
//         MemoryLocation::GpuOnly,
//         label,
//     )
// }

// pub fn vertex_buffer(gpu: &Gpu, size: u64, label: impl Into<String>) -> Result<Buffer<Vertex>> {
//     Buffer::new(
//         gpu.device(),
//         gpu.allocator(),
//         size,
//         BufferUsageFlags::VERTEX_BUFFER | BufferUsageFlags::TRANSFER_DST,
//         MemoryLocation::GpuOnly,
//         label,
//     )
// }

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

pub fn color_attachment<'a>(
    image: impl Texture,
    load_op: AttachmentLoadOp,
    store_op: AttachmentStoreOp,
    clear_color: [f32; 4],
) -> RenderingAttachmentInfo<'a> {
    RenderingAttachmentInfo::default()
        .clear_value(ClearValue {
            color: ClearColorValue {
                float32: clear_color,
            },
        })
        .image_view(image.view())
        .image_layout(ImageLayout::COLOR_ATTACHMENT_OPTIMAL)
        .load_op(load_op)
        .store_op(store_op)
}

pub fn color_attachment2<'a>(image: impl Texture) -> RenderingAttachmentInfo<'a> {
    RenderingAttachmentInfo::default()
        .clear_value(ClearValue {
            color: ClearColorValue {
                float32: [0.5, 0.5, 0.5, 1.0],
            },
        })
        .image_view(image.view())
        .image_layout(ImageLayout::COLOR_ATTACHMENT_OPTIMAL)
        .load_op(AttachmentLoadOp::LOAD)
        .store_op(AttachmentStoreOp::STORE)
}

pub fn depth_attachment<'a>(
    image: impl Texture,
    load_op: AttachmentLoadOp,
    store_op: AttachmentStoreOp,
    clear_depth: f32,
) -> RenderingAttachmentInfo<'a> {
    RenderingAttachmentInfo::default()
        .image_view(image.view())
        .image_layout(ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL)
        .clear_value(ClearValue {
            depth_stencil: ClearDepthStencilValue {
                depth: clear_depth,
                stencil: 0,
            },
        })
        .load_op(load_op)
        .store_op(store_op)
}

pub fn viewport_inverted(extent: Extent2D) -> vk::Viewport {
    vk::Viewport::default()
        .width(extent.width as f32)
        .height(0.0 - extent.height as f32)
        .x(0.)
        .y(extent.height as f32)
        .min_depth(0.)
        .max_depth(1.)
}

pub fn rgb_to_rgba(data_rgb: &[u8], extent: Extent2D) -> Vec<u8> {
    let image = image::DynamicImage::ImageRgb8(
        image::ImageBuffer::from_raw(extent.width, extent.height, data_rgb.to_vec()).expect("raw"),
    );
    let dest = image.to_rgba8();
    dest.as_bytes().to_vec()
}

pub fn calculate_normals(vertices: &[Vertex], indices: &[u32]) -> Vec<glam::Vec3> {
    let mut normals = vec![glam::Vec3::ZERO; vertices.len()];

    for i in (0..indices.len()).step_by(3) {
        let a = vertices[indices[i] as usize].position;
        let b = vertices[indices[i + 1] as usize].position;
        let c = vertices[indices[i + 2] as usize].position;
        let ba = (b - a).normalize();
        let ca = (c - a).normalize();
        let normal = ba.cross(ca).normalize();

        normals[indices[i] as usize] += normal;
        normals[indices[i + 1] as usize] += normal;
        normals[indices[i + 2] as usize] += normal;
    }
    for normal in &mut normals {
        *normal = normal.normalize();
    }

    normals
}
