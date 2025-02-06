use {
    crate::Allocator,
    crate::Device,
    anyhow::Result,
    ash::vk::{self, Extent3D, Handle},
    ash::vk::{Extent2D, Image as VkImage, ImageView as VkImageView},
    gpu_allocator::vulkan::Allocation,
    std::{fmt, sync::Arc},
};

pub use ash::vk::{ImageUsageFlags, ImageAspectFlags, Format};

#[derive(Clone, Debug, Copy)]
pub struct ImageInfo {
    pub label: Option<&'static str>,
    pub extent: Extent2D,
    pub format: Format,
    pub usage: ImageUsageFlags,
    pub aspect_flags: ImageAspectFlags,
}

pub struct Image {
    pub allocator: Option<Arc<Allocator>>,
    pub allocation: Allocation,
    pub handle: VkImage,
    pub view: VkImageView,
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
    pub fn from_existing(image: vk::Image, view: vk::ImageView, info: ImageInfo) -> Result<Self> {
        Ok(Self {
            allocator: None, //Arc::new(Allocator::default()),
            allocation: Allocation::default(),
            handle: image,
        info,
            view,
        })
    }
    pub fn new(allocator: Arc<Allocator>, device: &Device, info: ImageInfo) -> Result<Self> {
        let extent = Extent3D {
            width: info.extent.width,
            height: info.extent.height,
            depth: 1,
        };
        let create_info = &vk::ImageCreateInfo::default()
            .image_type(vk::ImageType::TYPE_2D)
            .format(info.format)
            .extent(extent)
            .mip_levels(1)
            .array_layers(1)
            .samples(vk::SampleCountFlags::TYPE_1)
            .tiling(vk::ImageTiling::OPTIMAL)
            .usage(info.usage | vk::ImageUsageFlags::TRANSFER_DST);
        let image = unsafe { device.create_image(create_info, None) }?;
        let requirements = unsafe { device.get_image_memory_requirements(image) };
        let allocation = allocator.allocate_image(image, requirements, info)?;

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

        let view = unsafe { device.create_image_view(&view_info, None) }?;

        Ok(Self {
            allocator: Some(allocator.clone()),
            allocation,
            handle: image,
            info,
            view,
        })
    }
}

impl Drop for Image {
    fn drop(&mut self) {
        log::info!("dropping image: {:?}", self.info.label);
        // if let Some(allocator) = &self.allocator {
            // let allocation = std::mem::take(&mut self.allocation);
            // allocator.deallocate(allocation);
        // }
    }
}
