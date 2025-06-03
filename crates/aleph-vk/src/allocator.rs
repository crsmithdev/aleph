use {
    crate::{Device, Instance},
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
    std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicU64, Ordering},
            Arc, Mutex,
        },
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct AllocationId(u64);

#[derive(Debug)]
struct AllocEntry {
    allocation: Allocation,
    buffer: Option<VkBuffer>,
    image: Option<VkImage>,
}

#[derive(Debug)]
pub struct Allocator {
    inner: Arc<Mutex<GpuAllocator>>,
    entries: Arc<Mutex<HashMap<AllocationId, AllocEntry>>>,
    device: Device,
}

impl Allocator {
    pub fn new(instance: &Instance, device: &Device) -> Result<Self> {
        let allocator = GpuAllocator::new(&AllocatorCreateDesc {
            instance: instance.handle().clone(),
            physical_device: device.physical_device,
            device: device.handle.clone(),
            buffer_device_address: true,
            debug_settings: AllocatorDebugSettings::default(),
            allocation_sizes: AllocationSizes::default(),
        })?;

        Ok(Self {
            inner: Arc::new(Mutex::new(allocator)),
            entries: Arc::new(Mutex::new(HashMap::new())),
            device: device.clone(),
        })
    }

    fn next_id() -> AllocationId {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        AllocationId(id)
    }

    pub fn allocate_buffer(
        &self,
        buffer: VkBuffer,
        requirements: MemoryRequirements,
        location: MemoryLocation,
        label: impl Into<String>,
    ) -> Result<AllocationId> {
        let allocation = {
            let mut allocator = self.inner.lock().expect("Could not acquire lock on allocator");
            allocator.allocate(&AllocationCreateDesc {
                name: &label.into(),
                requirements,
                location,
                linear: true,
                allocation_scheme: AllocationScheme::GpuAllocatorManaged,
            })?
        };

        unsafe {
            self.device
                .handle
                .bind_buffer_memory(buffer, allocation.memory(), allocation.offset())
        }?;

        let id = Self::next_id();
        let entry = AllocEntry {
            allocation,
            buffer: Some(buffer),
            image: None,
        };

        self.entries.lock().unwrap().insert(id, entry);
        Ok(id)
    }

    pub fn allocate_image(
        &self,
        image: VkImage,
        requirements: MemoryRequirements,
        label: &str,
    ) -> Result<AllocationId> {
        let allocation = {
            let mut allocator = self.inner.lock().unwrap();
            allocator.allocate(&AllocationCreateDesc {
                name: label,
                requirements,
                location: MemoryLocation::GpuOnly,
                linear: false,
                allocation_scheme: AllocationScheme::GpuAllocatorManaged,
            })?
        };

        unsafe {
            self.device.handle.bind_image_memory(image, allocation.memory(), allocation.offset())
        }?;

        let id = Self::next_id();
        let entry = AllocEntry {
            allocation,
            buffer: None,
            image: Some(image),
        };

        self.entries.lock().unwrap().insert(id, entry);
        Ok(id)
    }

    pub fn deallocate(&self, id: AllocationId) {
        if let Some(entry) = self.entries.lock().unwrap().remove(&id) {
            if let Some(buffer) = entry.buffer {
                unsafe { self.device.handle.destroy_buffer(buffer, None) };
            }
            if let Some(image) = entry.image {
                unsafe { self.device.handle.destroy_image(image, None) };
            }

            let mut allocator = self.inner.lock().unwrap();
            allocator.free(entry.allocation).unwrap();
        }
    }

    pub fn get_buffer(&self, id: AllocationId) -> VkBuffer {
        let entries = self.entries.lock().unwrap();
        entries
            .get(&id)
            .and_then(|entry| entry.buffer)
            .expect("Invalid buffer allocation ID")
    }

    pub fn get_image(&self, id: AllocationId) -> VkImage {
        let entries = self.entries.lock().unwrap();
        entries.get(&id).and_then(|entry| entry.image).expect("Invalid image allocation ID")
    }

    pub fn get_mapped_ptr(&self, id: AllocationId) -> Result<*mut u8> {
        let entries = self.entries.lock().unwrap();
        let entry = entries.get(&id).expect("Invalid allocation ID");

        if entry.buffer.is_none() {
            panic!("Allocation is not a buffer");
        }

        entry
            .allocation
            .mapped_ptr()
            .map(|ptr| ptr.cast::<u8>().as_ptr())
            .ok_or_else(|| anyhow::anyhow!("Buffer is not mapped"))
    }

    pub fn write_buffer<T: Copy>(&self, id: AllocationId, offset: u64, data: &[T]) -> Result<()> {
        let mapped_ptr = self.get_mapped_ptr(id)?;

        unsafe {
            let dst = mapped_ptr.add(offset as usize) as *mut T;
            std::ptr::copy_nonoverlapping(data.as_ptr(), dst, data.len());
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use {
        super::*,
        crate::test::test_gpu,
        ash::vk::{BufferCreateInfo, BufferUsageFlags, SharingMode},
    };

    #[test]
    #[cfg(feature = "gpu-tests")]
    fn test_buffer_allocation() {
        let gpu = test_gpu();
        let allocator = gpu.allocator();

        let create_info = BufferCreateInfo::default()
            .size(1024)
            .usage(BufferUsageFlags::VERTEX_BUFFER)
            .sharing_mode(SharingMode::EXCLUSIVE);

        let buffer = unsafe { gpu.device().handle.create_buffer(&create_info, None) }
            .expect("Failed to create buffer");
        let requirements = unsafe { gpu.device().handle.get_buffer_memory_requirements(buffer) };

        let id = allocator
            .allocate_buffer(buffer, requirements, MemoryLocation::CpuToGpu, "test")
            .expect("Failed to allocate buffer");

        let handle = allocator.get_buffer(id);
        assert_eq!(handle, buffer);
    }

    #[test]
    #[cfg(feature = "gpu-tests")]
    fn test_buffer_write() {
        let gpu = test_gpu();
        let allocator = gpu.allocator();

        let create_info = BufferCreateInfo::default()
            .size(64)
            .usage(BufferUsageFlags::UNIFORM_BUFFER)
            .sharing_mode(SharingMode::EXCLUSIVE);

        let buffer = unsafe { gpu.device().handle.create_buffer(&create_info, None) }
            .expect("Failed to create buffer");
        let requirements = unsafe { gpu.device().handle.get_buffer_memory_requirements(buffer) };

        let id = allocator
            .allocate_buffer(buffer, requirements, MemoryLocation::CpuToGpu, "write_test")
            .expect("Failed to allocate buffer");

        let data: [u32; 4] = [10, 20, 30, 40];
        allocator.write_buffer(id, 0, &data).expect("Failed to write buffer");
    }
}
