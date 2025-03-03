pub use ash::vk::{Format, ImageAspectFlags, ImageUsageFlags};
use {
    crate::vk::{Allocator, Device, Extent2D},
    anyhow::Result,
    ash::vk,
    derive_more::Debug,
    gpu_allocator::vulkan::Allocation,
    std::sync::Arc,
};

#[derive(Debug)]
pub struct Texture {
    image: Image2,
    view: vk::ImageView,
    extent: Extent2D,
    format: Format,
    sampler: vk::Sampler,
    label: String,
}

impl Texture {
    pub fn new(
        device: Device,
        allocator: Arc<Allocator>,
        extent: Extent2D,
        format: Format,
        usage: ImageUsageFlags,
        aspect_flags: ImageAspectFlags,
        label: impl Into<String>,
    ) -> Result<Self> {
        let label = label.into();
        let image = Image2::new(
            device.clone(),
            allocator,
            extent,
            format,
            usage,
            label.clone(),
        )?;
        let view_info = vk::ImageViewCreateInfo::default()
            .image(image.handle)
            .view_type(vk::ImageViewType::TYPE_2D)
            .format(format)
            .components(vk::ComponentMapping::default())
            .subresource_range(
                vk::ImageSubresourceRange::default()
                    .aspect_mask(aspect_flags)
                    .base_mip_level(0)
                    .level_count(1)
                    .base_array_layer(0)
                    .layer_count(1),
            );
        let view = unsafe { device.handle.create_image_view(&view_info, None) }?;
        let sampler = device.create_sampler(vk::Filter::LINEAR, vk::Filter::LINEAR)?;
        Ok(Self {
            image,
            view,
            extent,
            format,
            sampler,
            label,
        })
    }

    pub fn from_existing(
        device: &Device,
        image: vk::Image,
        view: vk::ImageView,
        extent: Extent2D,
        format: vk::Format,
        label: impl Into<String>,
    ) -> Result<Self> {
        let sampler = device.create_sampler(vk::Filter::LINEAR, vk::Filter::LINEAR)?;
        Ok(Self {
            image: Image2 {
                handle: image,
                allocation: ImageAllocation::External,
            },
            view,
            extent,
            format,
            sampler,
            label: label.into(),
        })
    }

    pub fn handle(&self) -> vk::Image { self.image.handle }

    pub fn view(&self) -> vk::ImageView { self.view }

    pub fn extent(&self) -> Extent2D { self.extent }

    pub fn format(&self) -> Format { self.format }

    pub fn sampler(&self) -> vk::Sampler { self.sampler }
}

#[derive(Debug)]
pub enum ImageAllocation {
    Internal {
        allocator: Arc<Allocator>,
        allocation: Allocation,
    },
    External,
}

#[derive(Debug)]
#[allow(dead_code)]
pub struct Image2 {
    handle: vk::Image,
    allocation: ImageAllocation,
}

impl Image2 {
    pub fn new(
        device: Device,
        allocator: Arc<Allocator>,
        extent: Extent2D,
        format: vk::Format,
        usage: ImageUsageFlags,
        label: impl Into<String>,
    ) -> Result<Self> {
        let info = &vk::ImageCreateInfo::default()
            .image_type(vk::ImageType::TYPE_2D)
            .format(format)
            .extent(extent.into())
            .mip_levels(1)
            .array_layers(1)
            .samples(vk::SampleCountFlags::TYPE_1)
            .tiling(vk::ImageTiling::OPTIMAL)
            .usage(usage | vk::ImageUsageFlags::TRANSFER_DST);
        let image = unsafe { device.handle.create_image(info, None) }?;
        let requirements = unsafe { device.handle.get_image_memory_requirements(image) };

        let allocation = {
            let allocation = allocator.allocate_image(image, requirements, &label.into())?;
            ImageAllocation::Internal {
                allocator,
                allocation,
            }
        };

        Ok(Self {
            allocation,
            handle: image,
        })
    }
}
