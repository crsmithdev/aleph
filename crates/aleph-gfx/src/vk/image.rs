pub use ash::vk::{Format, ImageAspectFlags, ImageUsageFlags};
use {
    crate::vk::{Allocator, Device},
    anyhow::Result,
    ash::vk::{self, Extent2D, Handle, Image as VkImage, ImageView as VkImageView},
    derive_more::Debug,
    gpu_allocator::vulkan::Allocation,
    std::fmt,
};

pub struct Texture2 {
    image: AllocatedImage,
    view: VkImageView,
    extent: Extent2D,
    format: Format,
    usage: ImageUsageFlags,
    aspect_flags: ImageAspectFlags,
    info: ImageInfo,
}

impl Texture2 {
    // pub fn from_existing(
    //     device: Device,
    //     image: VkImage,
    //     view: VkImageView,
    //     extent: Extent2D,
    //     format: Format, 
    //     usage: ImageUsageFlags,
    //     aspect_flags: ImageAspectFlags,
    // ) -> Result<Self> {
    //     Ok(Self {
    //         image: AllocatedImage {
    //             allocator: None,
    //             allocation: Allocation::default(),
    //             handle: image,
    //             extent: info.extent,
    //             format: info.format,
    //             usage: info.usage,
    //             aspect_flags: info.aspect_flags,
    //         },
    //         view,
    //         info,
    //     })
    // }
    // pub fn new(
    //     device: Device,
    //     allocator: Allocator,
    //     extent: Extent2D,
    //     format: Format,
    //     usage: ImageUsageFlags,
    //     aspect_flags: ImageAspectFlags,
    //     label: Option<&'static str>,
    // ) -> Result<Self> {
    //     let image = AllocatedImage::new(device.clone(), allocator, extent, format, usage, aspect_flags, label)?;
    //     let view_info = vk::ImageViewCreateInfo::default()
    //         .image(image.handle)
    //         .view_type(vk::ImageViewType::TYPE_2D)
    //         .format(format)
    //         .components(vk::ComponentMapping::default())
    //         .subresource_range(
    //             vk::ImageSubresourceRange::default()
    //                 .aspect_mask(aspect_flags)
    //                 .base_mip_level(0)
    //                 .level_count(1)
    //                 .base_array_layer(0)
    //                 .layer_count(1),
    //         );
    //     let view = unsafe { device.handle.create_image_view(&view_info, None) }?;
    //     Ok(Self { image, view, ex })
    // }
}

pub struct Image2 {
    handle: VkImage,
    view: VkImageView,
    extent: Extent2D,
    format: Format,
    usage: ImageUsageFlags,
    aspect_flags: ImageAspectFlags,
    allocation: ImageAllocation,
}

pub enum ImageAllocation {
    Internal {
        allocator: Allocator,
        allocation: Allocation,
    },
    External {}
}


pub struct AllocatedImage {
    pub allocator: Option<Allocator>,
    pub allocation: Allocation,
    pub handle: VkImage,
    pub extent: Extent2D,
    pub format: Format,
    pub usage: ImageUsageFlags,
    pub aspect_flags: ImageAspectFlags,
}

impl AllocatedImage {
    pub fn new(
        device: Device,
        allocator: Allocator,
        extent: Extent2D,
        format: Format,
        usage: ImageUsageFlags,
        aspect_flags: ImageAspectFlags,
        label: Option<&'static str>,
    ) -> Result<Self> {
        let create_info = &vk::ImageCreateInfo::default()
            .image_type(vk::ImageType::TYPE_2D)
            .format(format)
            .extent(extent.into())
            .mip_levels(1)
            .array_layers(1)
            .samples(vk::SampleCountFlags::TYPE_1)
            .tiling(vk::ImageTiling::OPTIMAL)
            .usage(usage | vk::ImageUsageFlags::TRANSFER_DST);
        let label = label.unwrap_or("image");
        let image = unsafe { device.handle.create_image(create_info, None) }?;
        let requirements = unsafe { device.handle.get_image_memory_requirements(image) };
        let allocation = allocator.allocate_image(image, requirements, label)?;
        Ok(Self {
            allocator: Some(allocator.clone()),
            allocation,
            handle: image,
            extent,
            format,
            usage,
            aspect_flags,
        })
    }
}

#[derive(Clone, Debug, Copy)]
pub struct ImageInfo {
    pub label: Option<&'static str>,
    pub extent: Extent2D,
    pub format: Format,
    pub usage: ImageUsageFlags,
    pub aspect_flags: ImageAspectFlags,
}

#[derive(Debug)]
pub struct Texture {
    pub allocator: Option<Allocator>,
    pub allocation: Allocation,
    pub handle: VkImage,
    pub view: VkImageView,
    pub info: ImageInfo,
    sampler: vk::Sampler,
}

impl Texture {
    pub fn handle(&self) -> VkImage { self.handle }

    pub fn view(&self) -> VkImageView { self.view }

    pub fn extent(&self) -> Extent2D { self.info.extent }

    pub fn sampler(&self) -> vk::Sampler { self.sampler }

    pub fn from_existing(
        device: &Device,
        image: vk::Image,
        view: vk::ImageView,
        info: ImageInfo,
    ) -> Result<Self> {
        let sampler = device.create_sampler(vk::Filter::LINEAR, vk::Filter::LINEAR)?;
        Ok(Self {
            allocator: None, //Arc::new(Allocator::default()),
            allocation: Allocation::default(),
            handle: image,
            sampler,
            info,
            view,
        })
    }
    pub fn new(device: Device, allocator: Allocator, info: ImageInfo) -> Result<Self> {
        let create_info = &vk::ImageCreateInfo::default()
            .image_type(vk::ImageType::TYPE_2D)
            .format(info.format)
            .extent(info.extent.into())
            .mip_levels(1)
            .array_layers(1)
            .samples(vk::SampleCountFlags::TYPE_1)
            .tiling(vk::ImageTiling::OPTIMAL)
            .usage(info.usage | vk::ImageUsageFlags::TRANSFER_DST);
        let label = info.label.unwrap_or("image");
        let image = unsafe { device.handle.create_image(create_info, None) }?;
        let requirements = unsafe { device.handle.get_image_memory_requirements(image) };
        let allocation = allocator.allocate_image(image, requirements, label)?;
        let sampler = device.create_sampler(vk::Filter::NEAREST, vk::Filter::NEAREST)?;

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

        let view = unsafe { device.handle.create_image_view(&view_info, None) }?;

        Ok(Self {
            allocator: Some(allocator.clone()),
            allocation,
            handle: image,
            sampler,
            info,
            view,
        })
    }
}

impl Drop for Texture {
    fn drop(&mut self) {
        // log::info!("dropping image: {:?}", self.info.label);
        // if let Some(allocator) = &self.allocator {
        // let allocation = std::mem::take(&mut self.allocation);
        // allocator.deallocate(allocation);
        // }
    }
}
