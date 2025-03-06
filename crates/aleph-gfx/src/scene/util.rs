use {
    super::assets::Material, crate::{
        vk::{
            buffer::*, AttachmentLoadOp, AttachmentStoreOp, BufferUsageFlags, ClearDepthStencilValue, ClearValue, Format, Gpu, ImageAspectFlags, ImageLayout, ImageUsageFlags, RenderingAttachmentInfo, Texture
        },
        Vertex,
    }, anyhow::Result, ash::vk::{Extent2D, Filter, SamplerMipmapMode}, bytemuck::Pod, image
};

pub fn single_color_image(gpu: &Gpu, pixel: [f32; 4], label: impl Into<String>) -> Result<Texture> {
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
        label.into()
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

pub fn load_default_material(gpu: &Gpu) -> Result<Material> {
    let base_color_texture = single_color_image(gpu, [1., 1., 1., 1.], "base_color")?;
    let normal_texture = single_color_image(gpu, [0.5, 0.5, 1., 1.], "normal")?;
    let metallic_texture = single_color_image(gpu, [0., 0., 0., 1.], "metallic")?;
    let roughness_texture = single_color_image(gpu, [0.5, 0.5, 0.5, 1.], "roughness")?;
    let occlusion_texture = single_color_image(gpu, [1., 1., 1., 1.], "occlusion")?;
    let sampler = gpu.create_sampler(Filter::NEAREST, Filter::NEAREST, SamplerMipmapMode::NEAREST)?;
    Ok(Material {
        base_color_texture,
        normal_texture,
        metallic_texture,
        metallic_factor: 0.,
        roughness_texture,
        roughness_factor: 0.,
        occlusion_texture,
        base_color_sampler: sampler,
        normal_sampler: sampler,
        metallic_roughness_sampler: sampler,
        occlusion_sampler: sampler,
    })
}