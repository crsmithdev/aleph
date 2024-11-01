use {
    crate::vk::{device::Device, instance::Instance, physical_device::PhysicalDevice},
    anyhow::Result,
    gpu_allocator::self as ga,
    std::{
        fmt,
        sync::{Arc, Mutex},
    },
};

// struct Image {
//     pub image: vk::Image,
//     pub view: vk::ImageView,
//     allocation: Allocation,
//     extent: vk::Extent3D,
//     format: vk::Format,
// }

pub struct Allocator {
    pub inner: Arc<Mutex<ga::vulkan::Allocator>>,
    pub device: Arc<Device>,
}

impl Allocator {
    pub fn new(
        instance: &Arc<Instance>,
        physical_device: &PhysicalDevice,
        device: &Arc<Device>,
    ) -> Result<Self> {
        let allocator = ga::vulkan::Allocator::new(&ga::vulkan::AllocatorCreateDesc {
            instance: instance.inner.clone(),
            device: device.inner.clone(),
            physical_device: physical_device.inner.clone(),
            buffer_device_address: true,
            debug_settings: ga::AllocatorDebugSettings::default(),
            allocation_sizes: ga::AllocationSizes::default(),
        })?;

        Ok(Self {
            inner: Arc::new(Mutex::new(allocator)),
            device: device.clone(),
        })
    }
}

impl fmt::Debug for Allocator {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let inner = self.inner.lock().unwrap();
        f.debug_struct("Allocator")
            .field("inner", &inner)
            .field("device", &self.device)
            .finish()
    }
}

// fn allocate(
//     allocator: &Arc<Mutex<Allocator>>,
//     device: &ash::Device,
//     bytes: usize,
//     flags: vk::BufferUsageFlags,
//     location: MemoryLocation,
// ) -> Result<(vk::Buffer, Allocation)> {
//     let mut allocator = allocator.lock().unwrap();
//     let info = vk::BufferCreateInfo::default()
//         .size(bytes as u64)
//         .usage(flags);
//     let buffer = unsafe { device.create_buffer(&info, None) }?;
//     let requirements = unsafe { device.get_buffer_memory_requirements(buffer) };

//     let allocation = allocator.allocate(&AllocationCreateDesc {
//         name: "Buffer",
//         requirements,
//         location,
//         linear: true,
//         allocation_scheme: AllocationScheme::GpuAllocatorManaged,
//     })?;

//     unsafe { device.bind_buffer_memory(buffer, allocation.memory(), allocation.offset()) }?;

//     Ok((buffer, allocation))
// }

// impl RenderBackend {
//     pub fn create_image(&self, format: vk::Format, extent: vk::Extent3D) -> Result<Image> {
//         // let allocation_info = AllocationCreateDesc {
//         //     name: "draw image",
//         //     requirements:
//         //     location: todo!(),
//         //     linear: todo!(),
//         //     allocation_scheme: todo!(),
//         // };

//         let image_info = vk::ImageCreateInfo::default()
//             .image_type(vk::ImageType::TYPE_2D)
//             .format(vk::Format::R16G16B16A16_SFLOAT)
//             .extent(extent.into())
//             .mip_levels(1)
//             .array_layers(1)
//             .samples(vk::SampleCountFlags::TYPE_1)
//             .tiling(vk::ImageTiling::OPTIMAL)
//             .usage(
//                 vk::ImageUsageFlags::TRANSFER_SRC
//                     | vk::ImageUsageFlags::TRANSFER_DST
//                     | vk::ImageUsageFlags::STORAGE
//                     | vk::ImageUsageFlags::COLOR_ATTACHMENT,
//             )
//             .sharing_mode(vk::SharingMode::EXCLUSIVE);
//         let image = unsafe { self.device.inner.create_image(&image_info, None) }?;

//         let memory_properties = &self.physical_device.memory_properties;
//         let image_memory_req = unsafe { self.device.inner.get_image_memory_requirements(image) };
//         let image_memory_index = self
//             .find_memorytype_index(
//                 &image_memory_req,
//                 memory_properties,
//                 vk::MemoryPropertyFlags::DEVICE_LOCAL,
//             )
//             .ok_or(anyhow!("Err"))?;
//         let image_allocate_info = vk::MemoryAllocateInfo::default()
//             .allocation_size(image_memory_req.size)
//             .memory_type_index(image_memory_index);
//         unsafe {
//             self.device
//                 .inner
//                 .allocate_memory(&image_allocate_info, None)?;
//         }
//         let _memory = unsafe {
//             self.device
//                 .inner
//                 .allocate_memory(&image_allocate_info, None)
//                 .unwrap()
//         };

//         let buffer_info = vk::BufferCreateInfo::default()
//             .size(512)
//             .usage(vk::BufferUsageFlags::STORAGE_BUFFER);

//         let buffer = unsafe { self.device.inner.create_buffer(&buffer_info, None) }.unwrap();
//         let requirements = unsafe { self.device.inner.get_buffer_memory_requirements(buffer) };

//         let mut allocator = self.allocator.lock().unwrap();
//         let allocation = allocator
//             .allocate(&AllocationCreateDesc {
//                 name: "Example allocation",
//                 requirements,
//                 location: MemoryLocation::CpuToGpu,
//                 linear: true,
//                 allocation_scheme: AllocationScheme::GpuAllocatorManaged,
//             })
//             .unwrap();

//         // Bind memory to the buffer
//         unsafe {
//             self.device
//                 .inner
//                 .bind_buffer_memory(buffer, allocation.memory(), allocation.offset())
//                 .unwrap()
//         };

//         Ok(Image {
//             image: image,
//             view: todo!(),
//             allocation,
//             extent: extent,
//             format: format,
//         })
//     }
// }

//     fn find_memorytype_index(
//         &self,
//         memory_req: &vk::MemoryRequirements,
//         memory_prop: &vk::PhysicalDeviceMemoryProperties,
//         flags: vk::MemoryPropertyFlags,
//     ) -> Option<u32> {
//         memory_prop.memory_types[..memory_prop.memory_type_count as _]
//             .iter()
//             .enumerate()
//             .find(|(index, memory_type)| {
//                 (1 << index) & memory_req.memory_type_bits != 0
//                     && memory_type.property_flags & flags == flags
//             })
//             .map(|(index, _memory_type)| index as _)
//     }
// }

// /*

// struct AllocatedImage {
//     VkImage image;
//     VkImageView imageView;
//     VmaAllocation allocation;
//     VkExtent3D imageExtent;
//     VkFormat imageFormat;
// };

// VkImageCreateInfo vkinit::image_create_info(VkFormat format, VkImageUsageFlags usageFlags,
// VkExtent3D extent) {
//     VkImageCreateInfo info = {};
//     info.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
//     info.pNext = nullptr;

//     info.imageType = VK_IMAGE_TYPE_2D;

//     info.format = format;
//     info.extent = extent;

//     info.mipLevels = 1;
//     info.arrayLayers = 1;

//     //for MSAA. we will not be using it by default, so default it to 1 sample per pixel.
//     info.samples = VK_SAMPLE_COUNT_1_BIT;

//     //optimal tiling, which means the image is stored on the best gpu format
//     info.tiling = VK_IMAGE_TILING_OPTIMAL;
//     info.usage = usageFlags;

//     return info;
// }

// VkImageViewCreateInfo vkinit::imageview_create_info(VkFormat format, VkImage image,
// VkImageAspectFlags aspectFlags) {
//     // build a image-view for the depth image to use for rendering
//     VkImageViewCreateInfo info = {};
//     info.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
//     info.pNext = nullptr;

//     info.viewType = VK_IMAGE_VIEW_TYPE_2D;
//     info.image = image;
//     info.format = format;
//     info.subresourceRange.baseMipLevel = 0;
//     info.subresourceRange.levelCount = 1;
//     info.subresourceRange.baseArrayLayer = 0;
//     info.subresourceRange.layerCount = 1;
//     info.subresourceRange.aspectMask = aspectFlags;

//     return info;
// }
//     //draw image size will match the window
//     VkExtent3D drawImageExtent = {
//         _windowExtent.width,
//         _windowExtent.height,
//         1
//     };

//     //hardcoding the draw format to 32 bit float
//     _drawImage.imageFormat = VK_FORMAT_R16G16B16A16_SFLOAT;
//     _drawImage.imageExtent = drawImageExtent;

//     VkImageUsageFlags drawImageUsages{};
//     drawImageUsages |= VK_IMAGE_USAGE_TRANSFER_SRC_BIT;
//     drawImageUsages |= VK_IMAGE_USAGE_TRANSFER_DST_BIT;
//     drawImageUsages |= VK_IMAGE_USAGE_STORAGE_BIT;
//     drawImageUsages |= VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;

//     VkImageCreateInfo rimg_info = vkinit::image_create_info(_drawImage.imageFormat,
// drawImageUsages, drawImageExtent);

//     //for the draw image, we want to allocate it from gpu local memory
//     VmaAllocationCreateInfo rimg_allocinfo = {};
//     rimg_allocinfo.usage = VMA_MEMORY_USAGE_GPU_ONLY;
//     rimg_allocinfo.requiredFlags = VkMemoryPropertyFlags(VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);

//     //allocate and create the image
//     vmaCreateImage(_allocator, &rimg_info, &rimg_allocinfo, &_drawImage.image,
// &_drawImage.allocation, nullptr);

//     //build a image-view for the draw image to use for rendering
//     VkImageViewCreateInfo rview_info = vkinit::imageview_create_info(_drawImage.imageFormat,
// _drawImage.image, VK_IMAGE_ASPECT_COLOR_BIT);

//     VK_CHECK(vkCreateImageView(_device, &rview_info, nullptr, &_drawImage.imageView));

//     //add to deletion queues
//     _mainDeletionQueue.push_function([=]() {
//         vkDestroyImageView(_device, _drawImage.imageView, nullptr);
//         vmaDestroyImage(_allocator, _drawImage.image, _drawImage.allocation);
//     });
//     */
