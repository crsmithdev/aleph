use {
    super::deletion::Destroyable,
    crate::{Allocator},
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
            allocation,
            handle: image,
            info: *info,
            view,
        })
    }
}

impl Destroyable for Image {
    fn destroy(&mut self) {
        let allocation = std::mem::take(&mut self.allocation);
        self.allocator
            .inner
            .lock()
            .unwrap()
            .free(allocation)
            .unwrap();
        unsafe {
            self.allocator
                .device
                .handle
                .destroy_image(self.handle, None);
            self.allocator
                .device
                .handle
                .destroy_image_view(self.view, None);
        };
    }
}
