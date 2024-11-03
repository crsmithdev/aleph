use {
    crate::vk::{instance::Instance, physical_device::PhysicalDevice, queue::Queue},
    aleph_core::constants::VK_TIMEOUT_NS,
    anyhow::Result,
    ash::{
        khr,
        vk::{self, Handle, PhysicalDeviceBufferDeviceAddressFeaturesKHR},
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
            ash::khr::buffer_device_address::NAME.as_ptr(),
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
        let mut buffer_device_address_features =
            PhysicalDeviceBufferDeviceAddressFeaturesKHR::default().buffer_device_address(true);
        let mut device_features = vk::PhysicalDeviceFeatures2::default()
            .push_next(&mut synchronization_features)
            .push_next(&mut buffer_device_address_features);

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
