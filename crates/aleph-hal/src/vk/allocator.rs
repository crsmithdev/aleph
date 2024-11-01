use {
    crate::vk::{device::Device, instance::Instance, physical_device::PhysicalDevice},
    anyhow::Result,
    gpu_allocator as ga,
    std::{
        fmt,
        sync::{Arc, Mutex},
    },
};

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
