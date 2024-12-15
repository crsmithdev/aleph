use {
    crate::vk::allocator::MemoryAllocator,
    anyhow::Result,
    ash::{vk, vk::Handle},
    gpu_allocator::{
        self as ga,
        vulkan::{Allocation, AllocationScheme},
        MemoryLocation,
    },
    std::{fmt, sync::Arc},
};

#[derive(Clone)]
pub struct ImageInfo {
    pub(crate) allocator: Arc<MemoryAllocator>,
    pub width: usize,
    pub height: usize,
    pub format: vk::Format,
    pub usage: vk::ImageUsageFlags,
    pub aspects: vk::ImageAspectFlags,
}

pub struct Image {
    pub allocator: Arc<MemoryAllocator>,
    pub allocation: Allocation,
    pub inner: vk::Image,
    pub view: vk::ImageView,
    pub extent: vk::Extent3D,
    pub format: vk::Format,
    pub usage: vk::ImageUsageFlags,
}

impl fmt::Debug for Image {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Image")
            .field("inner", &format_args!("{:x}", self.inner.as_raw()))
            .finish_non_exhaustive()
    }
}

impl MemoryAllocator {
    pub fn allocate_image(&self, info: &ImageInfo) -> Result<Image> {
        let extent = vk::Extent3D {
            width: info.width as u32,
            height: info.height as u32,
            depth: 1,
        };
        let image_info = vk::ImageCreateInfo::default()
            .image_type(vk::ImageType::TYPE_2D)
            .format(info.format)
            .extent(extent)
            .mip_levels(1)
            .array_layers(1)
            .samples(vk::SampleCountFlags::TYPE_1)
            .tiling(vk::ImageTiling::OPTIMAL)
            .usage(info.usage);
        let image = unsafe { self.device.inner.create_image(&image_info, None) }?;
        let requirements = unsafe { self.device.inner.get_image_memory_requirements(image) };
        let allocation = self.inner.lock().expect("lock").allocate(&ga::vulkan::AllocationCreateDesc {
            name: "Image",
            requirements,
            location: MemoryLocation::GpuOnly,
            linear: false,
            allocation_scheme: AllocationScheme::GpuAllocatorManaged,
        })?;
        unsafe {
            self.device
                .inner
                .bind_image_memory(image, allocation.memory(), allocation.offset())
        }?;

        let view_info = vk::ImageViewCreateInfo::default()
            .image(image)
            .view_type(vk::ImageViewType::TYPE_2D)
            .format(info.format)
            .components(vk::ComponentMapping::default())
            .subresource_range(
                vk::ImageSubresourceRange::default()
                    .aspect_mask(info.aspects)
                    .base_mip_level(0)
                    .level_count(1)
                    .base_array_layer(0)
                    .layer_count(1),
            );

        let view = unsafe {
            info.allocator
                .device
                .inner
                .create_image_view(&view_info, None)
        }?;

        Ok(Image {
            allocator: info.allocator.clone(),
            allocation,
            inner: image,
            extent,
            format: info.format,
            usage: info.usage,
            view,
        })
    }
}

impl MemoryAllocator {
    fn create_image(&self, info: &vk::ImageCreateInfo) -> Result<(vk::Image, Allocation)> {
        let image = unsafe { self.device.inner.create_image(info, None) }?;
        let requirements = unsafe { self.device.inner.get_image_memory_requirements(image) };
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
                .inner
                .bind_image_memory(image, allocation.memory(), allocation.offset())
        }?;
        Ok((image, allocation))
    }
}
