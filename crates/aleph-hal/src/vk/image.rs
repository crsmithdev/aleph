use {
    crate::{Allocator, Device, Buffer, CommandBuffer, MemoryLocation},
    anyhow::Result,
    ash::vk::{self, Extent3D, Handle},
    gpu_allocator::vulkan::Allocation,
    std::{fmt, sync::Arc},
};

#[derive(Clone, Debug, Copy)]
pub struct ImageInfo {
    pub extent: vk::Extent2D,
    pub format: vk::Format,
    pub usage: vk::ImageUsageFlags,
    pub aspect_flags: vk::ImageAspectFlags,
}

pub struct Image {
    pub allocator: Arc<Allocator>,
    pub allocation: Allocation,
    pub handle: vk::Image,
    pub view: vk::ImageView,
    pub info: ImageInfo,
    device: Device,
}

impl fmt::Debug for Image {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Image")
            .field("inner", &format_args!("{:x}", self.handle.as_raw()))
            .finish_non_exhaustive()
    }
}

impl Image {
    pub fn new(allocator: Arc<Allocator>, info: &ImageInfo) -> Result<Self> {
        let extent = Extent3D {
            width: info.extent.width,
            height: info.extent.height,
            depth: 1,
        };
        let create_info = vk::ImageCreateInfo::default()
            .image_type(vk::ImageType::TYPE_2D)
            .format(info.format)
            .extent(extent)
            .mip_levels(1)
            .array_layers(1)
            .samples(vk::SampleCountFlags::TYPE_1)
            .tiling(vk::ImageTiling::OPTIMAL)
            .usage(info.usage);
        let (image, allocation) = allocator.allocate_image(&create_info)?;

        let view_info = vk::ImageViewCreateInfo::default()
            .image(image)
            .view_type(vk::ImageViewType::TYPE_2D)
            .format(info.format)
            .components(vk::ComponentMapping::default())
            .subresource_range(
                vk::ImageSubresourceRange::default()
                    .aspect_mask(info.aspect_flags)
                    .base_mip_level(0)
                    .level_count(1)
                    .base_array_layer(0)
                    .layer_count(1),
            );

        let view = unsafe { allocator.device.create_image_view(&view_info, None) }?;

        Ok(Self {
            allocator: allocator.clone(),
            device: allocator.device.clone(),
            allocation,
            handle: image,
            info: *info,
            view,
        })
    }

    // pub fn upload_data<T: serde::Serialize>(
    //     &self,
    //     cmd: &CommandBuffer,
    //     data: &Buffer,
    //     dst: &Image,
    //     format: vk::Format,
    //     flags: vk::ImageUsageFlags,
    // ) -> Result<()> {
    //     let subresource = vk::ImageSubresourceLayers {
    //         aspect_mask: vk::ImageAspectFlags::COLOR,
    //         mip_level: 0,
    //         base_array_layer: 0,
    //         layer_count: 1,
    //     };

    //     let region = vk::BufferImageCopy {
    //         buffer_offset: 0,
    //         buffer_row_length: 0,
    //         buffer_image_height: 0,
    //         image_subresource: subresource,
    //         image_offset: vk::Offset3D::default(),
    //         image_extent: vk::Extent3D {
    //             width: self.info.extent.width,
    //             height: self.info.extent.height,
    //             depth: 1,
    //         },
    //     };

    //     cmd.submit_immediate(|cmd| {
    //         cmd.copy_buffer_to_image(data, self, format, &region);
    //     })

    //     // cmd.transition_image(image, current_layout, new_layout);
    // }
}
