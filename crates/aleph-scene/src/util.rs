use {
    crate::Vertex,
    aleph_vk::{
        AttachmentLoadOp, AttachmentStoreOp, ClearColorValue, ClearDepthStencilValue, ClearValue,
        Extent2D, Image, ImageLayout, RenderingAttachmentInfo, Viewport,
    },
    glam::Vec3,
    image::EncodableLayout,
};

pub fn color_attachment<'a>(
    image: &Image,
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

pub fn color_attachment2<'a>(image: &Image) -> RenderingAttachmentInfo<'a> {
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
    image: &Image,
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

pub fn viewport_inverted(extent: Extent2D) -> Viewport {
    Viewport::default()
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

pub fn rg_to_rgba(data_rg: &[u8], extent: Extent2D) -> Vec<u8> {
    let image = image::DynamicImage::ImageLumaA8(
        image::ImageBuffer::from_raw(extent.width, extent.height, data_rg.to_vec()).expect("raw"),
    );
    let dest = image.to_rgba8();
    dest.as_bytes().to_vec()
}

pub fn r_to_rgba(data_r: &[u8], extent: Extent2D) -> Vec<u8> {
    image::DynamicImage::ImageLuma8(
        image::ImageBuffer::from_raw(extent.width, extent.height, data_r.to_vec()).expect("raw"),
    )
    .to_rgba8()
    .as_bytes()
    .to_vec()
}

pub fn calculate_normals(vertices: &[Vec3], indices: &[u32]) -> Vec<glam::Vec3> {
    let mut normals = vec![glam::Vec3::ZERO; vertices.len()];

    for i in (0..indices.len()).step_by(3) {
        let a = vertices[indices[i] as usize];
        let b = vertices[indices[i + 1] as usize];
        let c = vertices[indices[i + 2] as usize];
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
