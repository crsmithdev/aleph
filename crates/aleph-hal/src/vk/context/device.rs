use {
    crate::vk::Instance,
    anyhow::{anyhow, Result},
    ash::{
        ext,
        khr,
        vk::{self, Handle},
    },
    derive_more::Debug,
    std::ffi,
};

const DEVICE_EXTENSIONS: [&ffi::CStr; 6] = [
    khr::swapchain::NAME,
    khr::synchronization2::NAME,
    
    khr::maintenance3::NAME,
    khr::dynamic_rendering::NAME,
    ext::descriptor_indexing::NAME,
    khr::buffer_device_address::NAME,
];

#[derive(Clone, Debug)]
pub struct Device {
    #[debug("{:x}", inner.handle().as_raw())]
    pub(crate) inner: ash::Device,
    pub(crate) queue: Queue,
    pub(crate) physical_device: vk::PhysicalDevice,
}

impl Device {
    pub fn handle(&self) -> &ash::Device {
        &self.inner
    }

    pub fn new(instance: &Instance) -> Result<Device> {
        let physical_device = Self::select_physical_device(instance)?;
        log::info!("Selected physical device: {physical_device:?}");

        let device_extension_names: Vec<*const i8> = DEVICE_EXTENSIONS
            .iter()
            .map(|n| n.as_ptr())
            .collect::<Vec<_>>();
        let mut synchronization_features =
            ash::vk::PhysicalDeviceSynchronization2FeaturesKHR::default().synchronization2(true);
        let mut dynamic_rendering_features =
            ash::vk::PhysicalDeviceDynamicRenderingFeaturesKHR::default().dynamic_rendering(true);
        let mut buffer_device_address_features =
            ash::vk::PhysicalDeviceBufferDeviceAddressFeaturesKHR::default()
                .buffer_device_address(true);
        let mut device_features = vk::PhysicalDeviceFeatures2::default()
            .push_next(&mut dynamic_rendering_features)
            .push_next(&mut synchronization_features)
            .push_next(&mut buffer_device_address_features);

        let priorities = [1.0];
        let (queue_family_index, _) =
            Self::find_queue_family(instance, &physical_device, vk::QueueFlags::GRAPHICS)?;
        let queue_info = [vk::DeviceQueueCreateInfo::default()
            .queue_family_index(queue_family_index)
            .queue_priorities(&priorities)];
        let device_info = vk::DeviceCreateInfo::default()
            .queue_create_infos(&queue_info)
            .enabled_extension_names(&device_extension_names)
            .push_next(&mut device_features);

        let inner = unsafe { instance.create_device(physical_device, &device_info, None)? };
        let queue = Queue::new(&inner, queue_family_index);

        Ok(Device {
            inner,
            queue,
            physical_device,
        })
    }

    fn select_physical_device(instance: &ash::Instance) -> Result<vk::PhysicalDevice> {
        let physical_devices = unsafe { instance.enumerate_physical_devices()? };

        let selected = physical_devices
            .into_iter()
            .rev()
            .max_by_key(|d| Self::rank_physical_device(instance, d));
        match selected {
            Some(device) => Ok(device),
            None => Err(anyhow!("No suitable physical device found")),
        }
    }

    fn rank_physical_device(instance: &ash::Instance, physical_device: &vk::PhysicalDevice) -> i32 {
        let device_properties =
            unsafe { instance.get_physical_device_properties(*physical_device) };
        let queue_families =
            unsafe { instance.get_physical_device_queue_family_properties(*physical_device) };

        // TODO extension checks

        let mut score = match queue_families
            .into_iter()
            .find(|qf| qf.queue_flags.contains(vk::QueueFlags::GRAPHICS))
        {
            Some(_) => 10000,
            None => 0,
        };

        score += match device_properties.device_type {
            vk::PhysicalDeviceType::INTEGRATED_GPU => 20,
            vk::PhysicalDeviceType::DISCRETE_GPU => 100,
            vk::PhysicalDeviceType::VIRTUAL_GPU => 1,
            _ => 0,
        };

        score
    }

    fn find_queue_family(
        instance: &ash::Instance,
        physical_device: &vk::PhysicalDevice,
        flags: vk::QueueFlags,
    ) -> Result<(u32, vk::QueueFamilyProperties)> {
        let queue_families =
            unsafe { instance.get_physical_device_queue_family_properties(*physical_device) };
        let selected = queue_families
            .into_iter()
            .enumerate()
            .find(|(_, qf)| qf.queue_flags.contains(flags));

        match selected {
            Some((index, properties)) => Ok((index as u32, properties)),
            None => Err(anyhow!("Could not find queue family with flags: {flags:?}")),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Queue {
    pub(crate) inner: vk::Queue,
    pub(crate) family_index: u32,
}

impl Queue {
    pub fn handle(&self) -> vk::Queue {
        self.inner
    }

    pub fn new(
        device: &ash::Device,
        queue_family_index: u32,
    ) -> Queue {
        let inner = unsafe { device.get_device_queue(queue_family_index, 0) };
        Queue {
            inner,
            family_index: queue_family_index,
        }
    }
}
