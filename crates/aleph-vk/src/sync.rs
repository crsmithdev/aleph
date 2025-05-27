use {
    crate::{Buffer, Image},
    ash::vk,
};

pub fn buffer_barrier(
    buffer: &Buffer,
    src_stage_mask: vk::PipelineStageFlags2,
    src_access_mask: vk::AccessFlags2,
    dst_stage_mask: vk::PipelineStageFlags2,
    dst_access_mask: vk::AccessFlags2,
) -> vk::BufferMemoryBarrier2 {
    let barrier = vk::BufferMemoryBarrier2::default()
        .buffer(buffer.handle())
        .src_stage_mask(src_stage_mask)
        .dst_stage_mask(dst_stage_mask)
        .src_access_mask(src_access_mask)
        .dst_access_mask(dst_access_mask)
        .src_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
        .dst_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
        .size(buffer.size())
        .offset(0);
    log::trace!("Created buffer memory barrier {barrier:?} for {buffer:?}");
    barrier
}

pub fn memory_barrier<'a>(
    src_stage_mask: vk::PipelineStageFlags2,
    src_access_mask: vk::AccessFlags2,
    dst_stage_mask: vk::PipelineStageFlags2,
    dst_access_mask: vk::AccessFlags2,
) -> vk::MemoryBarrier2<'a> {
    let barrier = vk::MemoryBarrier2::default()
        .src_stage_mask(src_stage_mask)
        .dst_stage_mask(dst_stage_mask)
        .src_access_mask(src_access_mask)
        .dst_access_mask(dst_access_mask);
    log::trace!("Created memory barrier {barrier:?}");
    barrier
}

pub fn image_memory_barrier(
    image: &Image,
    src_stage_mask: vk::PipelineStageFlags2,
    src_access_mask: vk::AccessFlags2,
    dst_stage_mask: vk::PipelineStageFlags2,
    dst_access_mask: vk::AccessFlags2,
    old_layout: vk::ImageLayout,
    new_layout: vk::ImageLayout,
) -> vk::ImageMemoryBarrier2 {
    let range = vk::ImageSubresourceRange::default()
        .aspect_mask(image.aspect_flags())
        .base_mip_level(0)
        .level_count(1)
        .base_array_layer(0)
        .layer_count(1);
    let barrier = vk::ImageMemoryBarrier2::default()
        .image(image.handle())
        .src_stage_mask(src_stage_mask)
        .src_access_mask(src_access_mask)
        .dst_stage_mask(dst_stage_mask)
        .dst_access_mask(dst_access_mask)
        .src_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
        .dst_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
        .old_layout(old_layout)
        .new_layout(new_layout)
        .subresource_range(range);

    log::trace!("Created image memory barrier {barrier:?} for {image:?}");
    barrier
}
