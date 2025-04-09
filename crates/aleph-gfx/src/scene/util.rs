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
    ash::vk::{self, ClearColorValue, Extent2D, Image},
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

pub fn single_color_image(gpu: &Gpu, pixel: [f32; 4], format: vk::Format, label: impl Into<String>) -> Result<Texture> {
    let extent = Extent2D {
        width: 1,
        height: 1,
    };
    let pixels = &[pixel];
    let data = bytemuck::bytes_of(pixels);
    let sampler = default_sampler(gpu)?;
    let image = gpu.create_image(
        extent,
        Format::R8G8B8A8_SRGB,
        ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
        ImageAspectFlags::COLOR,
        label.into(),
        Some(sampler),
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

pub fn color_attachment<'a>(
    image: &Texture,
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

// pub fn color_attachment<'a>(image: &Texture) -> RenderingAttachmentInfo<'a> {
//     RenderingAttachmentInfo::default()
//         .clear_value(ClearValue {
//             color: ClearColorValue {
//                 float32: [0.5, 0.5, 0.5, 1.0],
//             },
//         })
//         .image_view(image.view())
//         .image_layout(ImageLayout::COLOR_ATTACHMENT_OPTIMAL)
//         .load_op(AttachmentLoadOp::CLEAR)
//         .store_op(AttachmentStoreOp::STORE)
// }

pub fn color_attachment2<'a>(image: &Texture) -> RenderingAttachmentInfo<'a> {
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
    image: &Texture,
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

// pub fn depth_attachment2<'a>(image: &Texture) -> RenderingAttachmentInfo<'a> {
//     RenderingAttachmentInfo::default()
//         .image_view(image.view())
//         .image_layout(ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL)
//         .clear_value(ClearValue {
//             depth_stencil: ClearDepthStencilValue {
//                 depth: 1.0,
//                 stencil: 0,
//             },
//         })
//         .load_op(AttachmentLoadOp::LOAD)
//         .store_op(AttachmentStoreOp::STORE)
// }

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
