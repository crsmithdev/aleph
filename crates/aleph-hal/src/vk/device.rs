use {
    crate::vk::{
        instance::Instance, physical_device::PhysicalDevice, queue::Queue,
    },
    aleph_core::constants::VK_TIMEOUT_NS,
    anyhow::Result,
    ash::{
        khr,
        vk::{self, Handle},
    },
    std::{fmt, sync::Arc},
};

pub struct Device {
    pub inner: ash::Device,
    pub(crate) physical_device: Arc<PhysicalDevice>,
    pub queue: Queue,
}

impl Device {
    pub fn new(
        instance: &Arc<Instance>,
        physical_device: &Arc<PhysicalDevice>,
    ) -> Result<Arc<Device>> {
        let device_extension_names = vec![
            khr::swapchain::NAME.as_ptr(),
            khr::synchronization2::NAME.as_ptr(),
            khr::maintenance3::NAME.as_ptr(),
            khr::dynamic_rendering::NAME.as_ptr(),
            ash::ext::descriptor_indexing::NAME.as_ptr(),
            ash::ext::buffer_device_address::NAME.as_ptr(),
        ];
        let priorities = [1.0];

        let queue_family = physical_device
            .queue_families
            .iter()
            .filter(|qf| qf.properties.queue_flags.contains(vk::QueueFlags::GRAPHICS))
            .copied()
            .next()
            .unwrap();

        let queue_info = [vk::DeviceQueueCreateInfo::default()
            .queue_family_index(queue_family.index)
            .queue_priorities(&priorities)];

        let mut synchronization_features =
            ash::vk::PhysicalDeviceSynchronization2FeaturesKHR::default().synchronization2(true);
        let mut device_features =
            vk::PhysicalDeviceFeatures2::default().push_next(&mut synchronization_features);

        let device_info = vk::DeviceCreateInfo::default()
            .queue_create_infos(&queue_info)
            .enabled_extension_names(&device_extension_names)
            .push_next(&mut device_features);

        let device = unsafe {
            instance
                .inner
                .create_device(physical_device.inner, &device_info, None)
                .unwrap()
        };

        let queue = Queue {
            inner: unsafe { device.get_device_queue(queue_family.index, 0) },
            family: queue_family,
        };

        Ok(Arc::new(Device {
            physical_device: physical_device.clone(),
            inner: device,
            queue,
        }))
    }

    pub fn wait_for_fence(&self, fence: vk::Fence) -> Result<()> {
        Ok(unsafe { self.inner.wait_for_fences(&[fence], true, VK_TIMEOUT_NS)? })
    }

    pub fn reset_fence(&self, fence: vk::Fence) -> Result<()> {
        Ok(unsafe { self.inner.reset_fences(&[fence])? })
    }

    pub fn create_fence(&self) -> Result<vk::Fence> {
        self.create_fence_(vk::FenceCreateFlags::empty())
    }

    pub fn create_fence_signaled(&self) -> Result<vk::Fence> {
        self.create_fence_(vk::FenceCreateFlags::SIGNALED)
    }

    fn create_fence_(&self, flags: vk::FenceCreateFlags) -> Result<vk::Fence> {
        Ok(unsafe {
            self.inner
                .create_fence(&vk::FenceCreateInfo::default().flags(flags), None)?
        })
    }

    pub fn create_semaphore(&self) -> Result<vk::Semaphore> {
        Ok(unsafe {
            self.inner
                .create_semaphore(&vk::SemaphoreCreateInfo::default(), None)?
        })
    }

    pub fn create_image_view(&self, info: vk::ImageViewCreateInfo) -> Result<vk::ImageView> {
        Ok(unsafe { self.inner.create_image_view(&info, None)? })
    }
}

impl fmt::Debug for Device {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.debug_struct("Device")
            .field(
                "inner",
                &format_args!("{:x}", &self.inner.handle().as_raw()),
            )
            .field("physical_device", &self.physical_device)
            .field("queue", &self.queue.inner)
            .finish()
    }
}

// pub fn begin_command_buffer(&self) -> Result<()> {
//     Ok(unsafe {
//         let fences = &[self.command_buffer_fence];
//         self.inner.wait_for_fences(fences, true, u64::MAX)?;
//         self.inner.reset_fences(fences)?;
//         self.inner.reset_command_buffer(
//             self.command_buffer.inner,
//             vk::CommandBufferResetFlags::RELEASE_RESOURCES,
//         )?;

//         let command_buffer_begin_info = vk::CommandBufferBeginInfo::default()
//             .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT);

//         self.inner
//             .begin_command_buffer(self.command_buffer.inner, &command_buffer_begin_info)?
//     })
// }

// pub fn end_command_buffer(
//     &self,
//     wait_semaphores: &[vk::Semaphore],
//     signal_semaphores: &[vk::Semaphore],
//     wait_mask: &[vk::PipelineStageFlags],
// ) -> Result<()> {
//     log::info!("Ending command buffer...        ");
//     log::info!("Wait semaphores: {wait_semaphores:?}");
//     log::info!("Signal semaphores: {signal_semaphores:?}");
//     log::info!("Wait mask: {wait_mask:?}");

//     Ok(unsafe {
//         self.inner.end_command_buffer(self.command_buffer.inner)?;

//         let buffers = &[self.command_buffer.inner];
//         let submit_info = vk::SubmitInfo::default()
//             .wait_semaphores(wait_semaphores)
//             .wait_dst_stage_mask(wait_mask)
//             .command_buffers(buffers)
//             .signal_semaphores(signal_semaphores);

//         self.inner
//             .queue_submit(self.queue.inner, &[submit_info], self.command_buffer_fence)?
//     })
// }

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

// pub fn create_command_buffer(&self) -> CommandBuffer {
//     let command_buffer_allocate_info = vk::CommandBufferAllocateInfo::default()
//         .command_buffer_count(1)
//         .command_pool(self.command_pool)
//         .level(vk::CommandBufferLevel::PRIMARY);

//     Self::allocate_command_buffer(self.inner.clone(), command_buffer_allocate_info)
// }

// pub fn create_buffer<T>(&self, desc: BufferDesc, initial_data: Option<&[T]>) ->
// Result<Buffer> {     let mut flags: vk::BufferUsageFlags = desc.usage.into();
//     if initial_data.is_some() {
//         flags |= vk::BufferUsageFlags::TRANSFER_DST;
//     }
//     let initial_data = initial_data.unwrap();
//     let size = initial_data.len() * size_of::<T>();
//     let (buffer, allocation) = allocate(
//         &self.allocator,
//         &self.inner,
//         size,
//         flags,
//         MemoryLocation::CpuToGpu,
//     )
//     .unwrap();

//     self.write_buffer(&allocation, initial_data)?;
//     Ok(Buffer {
//         inner: buffer,
//         allocation,
//     })
// }

// pub fn write_buffer<T: Sized>(&self, allocation: &Allocation, data: &[T]) -> Result<()> {
//     let buffer_ptr = allocation.mapped_ptr().unwrap().cast().as_ptr();
//     unsafe { ptr::copy_nonoverlapping(data.as_ptr(), buffer_ptr, data.len()) }

//     Ok(())
// }

// fn find_memorytype_index(
//     &self,
//     memory_req: &vk::MemoryRequirements,
//     memory_prop: &vk::PhysicalDeviceMemoryProperties,
//     flags: vk::MemoryPropertyFlags,
// ) -> Option<u32> {
//     memory_prop.memory_types[..memory_prop.memory_type_count as _]
//         .iter()
//         .enumerate()
//         .find(|(index, memory_type)| {
//             (1 << index) & memory_req.memory_type_bits != 0
//                 && memory_type.property_flags & flags == flags
//         })
//         .map(|(index, _memory_type)| index as _)
// }

// fn allocate_command_buffer(
//     device: ash::Device,
//     info: vk::CommandBufferAllocateInfo,
// ) -> CommandBuffer {
//     let command_buffers = unsafe { device.allocate_command_buffers(&info).unwrap() };

//     CommandBuffer {
//         inner: command_buffers[0],
//     }
// }

// pub struct Texture {
//     pub image: vk::Image,
//     pub view: vk::ImageView,
//     pub memory: vk::DeviceMemory,
// }
