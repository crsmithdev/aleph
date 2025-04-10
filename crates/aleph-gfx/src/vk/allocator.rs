use {
    crate::vk::{Device, Instance},
    anyhow::Result,
    ash::vk::{Buffer as VkBuffer, Image as VkImage, MemoryRequirements},
    derive_more::Debug,
    gpu_allocator::{
        vulkan::{
            Allocation, AllocationCreateDesc, AllocationScheme, Allocator as GpuAllocator,
            AllocatorCreateDesc,
        },
        AllocationSizes, AllocatorDebugSettings, MemoryLocation,
    },
    std::sync::{Arc, Mutex},
};

#[derive(Debug)]
pub struct Allocator {
    pub(crate) inner: Arc<Mutex<GpuAllocator>>,
    pub(crate) device: Device,
}

impl Allocator {
    pub fn new(instance: &Instance, device: &Device) -> Result<Self> {
        let allocator = GpuAllocator::new(&AllocatorCreateDesc {
            instance: instance.handle.clone(),
            physical_device: device.physical_device,
            device: device.handle.clone(),
            buffer_device_address: true,
            debug_settings: AllocatorDebugSettings::default(),
            allocation_sizes: AllocationSizes::default(),
        })?;

        Ok(Self {
            inner: Arc::new(Mutex::new(allocator)),
            device: device.clone(),
        })
    }

    pub(crate) fn allocate_buffer(
        &self,
        buffer: VkBuffer,
        requirements: MemoryRequirements,
        location: MemoryLocation,
        label: impl Into<String>,
    ) -> Result<Allocation> {
        let mut allocator = self
            .inner
            .lock()
            .expect("Could not acquire lock on allocator");
        let allocation = allocator.allocate(&AllocationCreateDesc {
            name: &label.into(),
            requirements,
            location,
            linear: true,
            allocation_scheme: AllocationScheme::GpuAllocatorManaged,
        })?;

        unsafe {
            self.device
                .handle
                .bind_buffer_memory(buffer, allocation.memory(), allocation.offset())
        }?;

        Ok(allocation)
    }

    pub(crate) fn allocate_image(
        &self,
        image: VkImage,
        requirements: MemoryRequirements,
        label: &str,
    ) -> Result<Allocation> {
        let mut allocator = self.inner.lock().unwrap();
        let allocation = allocator.allocate(&AllocationCreateDesc {
            name: label,
            requirements,
            location: MemoryLocation::GpuOnly,
            linear: false,
            allocation_scheme: AllocationScheme::GpuAllocatorManaged,
        })?;
        unsafe {
            self.device
                .handle
                .bind_image_memory(image, allocation.memory(), allocation.offset())
        }?;
        Ok(allocation)
    }

    pub fn deallocate(&self, allocation: Allocation) {
        self.inner.lock().unwrap().free(allocation).unwrap();
    }
}
