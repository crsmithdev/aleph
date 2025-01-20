use {
    crate::vk::allocator::Allocator,
    anyhow::Result,
    ash::vk::{self, Extent3D, Handle},
    gpu_allocator::{
        self as ga,
        vulkan::{Allocation, AllocationScheme},
        MemoryLocation,
    },
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
        let (image, allocation) = allocator.create_image(&create_info)?;

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


        let view = unsafe {
            allocator
                .device
                .create_image_view(&view_info, None)
        }?;

        Ok(Self {
            allocator: allocator.clone(),
            allocation,
            handle: image,
            info: *info,
            view,
        })
    }
}

impl Allocator {
    fn create_image(&self, info: &vk::ImageCreateInfo) -> Result<(vk::Image, Allocation)> {
        let image = unsafe { self.device.create_image(info, None) }?;
        let requirements = unsafe { self.device.get_image_memory_requirements(image) };
        let mut allocator = self.inner.lock().unwrap();
        let allocation = allocator.allocate(&ga::vulkan::AllocationCreateDesc {
            name: "Image",
            requirements,
            location: MemoryLocation::GpuOnly,
            linear: false,
            allocation_scheme: AllocationScheme::GpuAllocatorManaged,
        })?;
        unsafe {
            self.device
                .bind_image_memory(image, allocation.memory(), allocation.offset())
        }?;
        Ok((image, allocation))
    }
}
