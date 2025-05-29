use {
    crate::{Buffer, Image},
    ash::vk::{
            AccessFlags2, BufferMemoryBarrier2, ImageLayout, ImageMemoryBarrier2,
            ImageSubresourceRange, MemoryBarrier2, PipelineStageFlags2,
            QUEUE_FAMILY_IGNORED,
        },
};

pub fn buffer_barrier(
    buffer: &Buffer,
    src_stage_mask: PipelineStageFlags2,
    src_access_mask: AccessFlags2,
    dst_stage_mask: PipelineStageFlags2,
    dst_access_mask: AccessFlags2,
) -> BufferMemoryBarrier2 {
    let barrier = BufferMemoryBarrier2::default()
        .buffer(buffer.handle())
        .src_stage_mask(src_stage_mask)
        .dst_stage_mask(dst_stage_mask)
        .src_access_mask(src_access_mask)
        .dst_access_mask(dst_access_mask)
        .src_queue_family_index(QUEUE_FAMILY_IGNORED)
        .dst_queue_family_index(QUEUE_FAMILY_IGNORED)
        .size(buffer.size())
        .offset(0);
    // log::trace!("Created buffer memory barrier {barrier:?} for {buffer:?}");
    barrier
}

pub fn memory_barrier<'a>(
    src_stage_mask: PipelineStageFlags2,
    src_access_mask: AccessFlags2,
    dst_stage_mask: PipelineStageFlags2,
    dst_access_mask: AccessFlags2,
) -> MemoryBarrier2<'a> {
    let barrier = MemoryBarrier2::default()
        .src_stage_mask(src_stage_mask)
        .dst_stage_mask(dst_stage_mask)
        .src_access_mask(src_access_mask)
        .dst_access_mask(dst_access_mask);
    // log::trace!("Created memory barrier {barrier:?}");
    barrier
}

pub fn image_memory_barrier(
    image: &Image,
    src_stage_mask: PipelineStageFlags2,
    src_access_mask: AccessFlags2,
    dst_stage_mask: PipelineStageFlags2,
    dst_access_mask: AccessFlags2,
    old_layout: ImageLayout,
    new_layout: ImageLayout,
) -> ImageMemoryBarrier2 {
    let range = ImageSubresourceRange::default()
        .aspect_mask(image.aspect_flags())
        .base_mip_level(0)
        .level_count(1)
        .base_array_layer(0)
        .layer_count(1);
    let barrier = ImageMemoryBarrier2::default()
        .image(image.handle())
        .src_stage_mask(src_stage_mask)
        .src_access_mask(src_access_mask)
        .dst_stage_mask(dst_stage_mask)
        .dst_access_mask(dst_access_mask)
        .src_queue_family_index(QUEUE_FAMILY_IGNORED)
        .dst_queue_family_index(QUEUE_FAMILY_IGNORED)
        .old_layout(old_layout)
        .new_layout(new_layout)
        .subresource_range(range);

    // log::trace!("Created image memory barrier {barrier:?} for {image:?}");
    barrier
}
