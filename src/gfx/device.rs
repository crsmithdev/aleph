use crate::{
    gfx::physical_device::{PhysicalDevice, QueueFamily},
    prelude::Instance,
};
use anyhow::Result;
use ash::vk::{self, Handle};
use gpu_allocator::vulkan::{Allocator, AllocatorCreateDesc};
use std::{
    fmt,
    sync::{Arc, Mutex},
};
pub struct Queue {
    pub raw: vk::Queue,
    pub family: QueueFamily,
}

#[allow(dead_code)]
pub struct Device {
    pub raw: ash::Device,
    pub(crate) physical_device: Arc<PhysicalDevice>,
    pub instance: Arc<Instance>,
    pub universal_queue: Queue,
    pub allocator: Arc<Mutex<Allocator>>,
}

impl Device {
    pub fn create(
        instance: Arc<Instance>,
        physical_device: Arc<PhysicalDevice>,
    ) -> Result<Arc<Self>> {
        let device_extension_names = vec![ash::khr::swapchain::NAME.as_ptr()];
        let priorities = [1.0];

        let queue = physical_device
            .queue_families
            .iter()
            .filter(|qf| qf.properties.queue_flags.contains(vk::QueueFlags::GRAPHICS))
            .copied()
            .next()
            .unwrap();

        let queue_info = [vk::DeviceQueueCreateInfo::default()
            .queue_family_index(queue.index)
            .queue_priorities(&priorities)];

        let mut device_features = vk::PhysicalDeviceFeatures2::default();

        let device_info = vk::DeviceCreateInfo::default()
            .queue_create_infos(&queue_info)
            .enabled_extension_names(&device_extension_names)
            .push_next(&mut device_features);

        let device = unsafe {
            instance
                .raw
                .create_device(physical_device.inner, &device_info, None)
                .unwrap()
        };

        log::info!("Created a Vulkan device");

        let allocator = Allocator::new(&AllocatorCreateDesc {
            instance: instance.raw.clone(),
            device: device.clone(),
            physical_device: physical_device.inner,
            buffer_device_address: true,
            debug_settings: Default::default(),
            allocation_sizes: Default::default(),
        })?;

        let queue = Queue {
            raw: unsafe { device.get_device_queue(queue.index, 0) },
            family: queue,
        };

        Ok(Arc::new(Device {
            physical_device: physical_device.clone(),
            raw: device,
            instance: instance.clone(),
            universal_queue: queue,
            allocator: Arc::new(Mutex::new(allocator)),
        }))
    }
}

impl fmt::Debug for Device {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Device")
            .field("inner", &format_args!("{:x}", &self.raw.handle().as_raw()))
            .field("instance", &self.instance) // &format_args!("{:x}", &self.raw.handle().as_raw()))
            .field("physical_device", &self.physical_device) // &format_args!("{:x}", &self.raw.handle().as_raw()))
            .finish_non_exhaustive()
    }
}
