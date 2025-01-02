pub use gavk::Allocation;
use {
    crate::vk::{buffer::BufferInfo, Device, Instance},
    anyhow::Result,
    ash::vk::{self, Handle},
    derive_more::Debug,
    gpu_allocator::{self as ga, vulkan as gavk},
    std::sync::{Arc, Mutex},
};

#[derive(Debug)]
pub struct MemoryAllocator {
    pub(crate) inner: Arc<Mutex<gavk::Allocator>>,
    pub(crate) device: Device,
}

impl MemoryAllocator {
    pub fn inner(&self) -> &Arc<Mutex<gavk::Allocator>> {
        &self.inner
    }
    pub fn new(instance: &Instance, device: &Device) -> Result<Self> {
        let allocator = gavk::Allocator::new(&gavk::AllocatorCreateDesc {
            instance: instance.inner.clone(),
            physical_device: device.physical_device,
            device: device.inner.clone(),
            buffer_device_address: true,
            debug_settings: ga::AllocatorDebugSettings::default(),
            allocation_sizes: ga::AllocationSizes::default(),
        })?;

        Ok(Self {
            inner: Arc::new(Mutex::new(allocator)),
            device: device.clone(),
        })
    }

    pub fn allocate_buffer(&self, buffer: vk::Buffer, info: BufferInfo) -> Result<Allocation> {
        let requirements = unsafe { self.device.inner.get_buffer_memory_requirements(buffer) };

        let mut allocator = self
            .inner
            .lock()
            .expect("Could not acquire lock on allocator");
        let allocation = allocator.allocate(&gavk::AllocationCreateDesc {
            name: "un-named buffer",
            requirements,
            location: info.location,
            linear: true,
            allocation_scheme: gavk::AllocationScheme::GpuAllocatorManaged,
        })?;

        unsafe {
            self.device
                .inner
                .bind_buffer_memory(buffer, allocation.memory(), allocation.offset())
        }?;

        Ok(allocation)
    }
}

#[derive(Debug)]
pub struct DescriptorAllocator {
    pool: vk::DescriptorPool,
    #[debug("{:x}", device.handle().as_raw())]
    pub(crate) device: ash::Device,
}

impl DescriptorAllocator {
    pub fn new(
        device: &ash::Device,
        pool_sizes: &[vk::DescriptorPoolSize],
        max_sets: u32,
    ) -> Result<DescriptorAllocator> {
        let info = vk::DescriptorPoolCreateInfo::default()
            .max_sets(max_sets)
            .pool_sizes(pool_sizes);
        let pool = unsafe { device.create_descriptor_pool(&info, None) }?;

        Ok(DescriptorAllocator {
            pool,
            device: device.clone(),
        })
    }

    pub fn clear(&self) -> Result<()> {
        #[allow(clippy::unit_arg)]
        Ok(unsafe {
            self.device
                .reset_descriptor_pool(self.pool, vk::DescriptorPoolResetFlags::empty())?
        })
    }

    pub fn destroy(&self) {
        unsafe {
            self.device.destroy_descriptor_pool(self.pool, None);
        }
    }

    pub fn allocate(&self, layout: &vk::DescriptorSetLayout) -> Result<vk::DescriptorSet> {
        let layouts = &[*layout];
        let info = vk::DescriptorSetAllocateInfo::default()
            .descriptor_pool(self.pool)
            .set_layouts(layouts);
        let sets = unsafe { self.device.allocate_descriptor_sets(&info) }?;
        Ok(sets[0])
    }
}
