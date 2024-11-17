use {
    anyhow::Result, ash::vk, gpu_allocator as ga, std::{
        fmt,
        sync::{Arc, Mutex},
    }
};

pub struct Allocator {
    pub inner: Arc<Mutex<ga::vulkan::Allocator>>,
    pub physical_device: vk::PhysicalDevice,
    pub device: ash::Device,
}

impl Allocator {
    pub fn new(
        instance: &ash::Instance,
        physical_device: &vk::PhysicalDevice,
        device: &ash::Device,
    ) -> Result<Self> {
        let allocator = ga::vulkan::Allocator::new(&ga::vulkan::AllocatorCreateDesc {
            instance: instance.clone(),
            device: device.clone(),
            physical_device: physical_device.clone(),
            buffer_device_address: true,
            debug_settings: ga::AllocatorDebugSettings::default(),
            allocation_sizes: ga::AllocationSizes::default(),
        })?;

        Ok(Self {
            inner: Arc::new(Mutex::new(allocator)),
            physical_device: physical_device.clone(),
            device: device.clone(),
        })
    }
}

impl fmt::Debug for Allocator {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let inner = self.inner.lock().unwrap();
        f.debug_struct("Allocator")
            .field("inner", &inner)
            .field("device", &self.physical_device)
            .finish()
    }
}
