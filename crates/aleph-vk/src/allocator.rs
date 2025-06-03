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
pub struct Allocator {
    inner: Arc<Mutex<GpuAllocator>>,
    entries: Arc<Mutex<HashMap<AllocationId, Allocation>>>,
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
        self.entries.lock().expect("Failed to acquire entries lock").insert(id, allocation);
        Ok(id)
    }

    pub fn allocate_image(
        &self,
        image: VkImage,
        requirements: MemoryRequirements,
        label: &str,
    ) -> Result<AllocationId> {
        let allocation = {
            let mut allocator = self.inner.lock().expect("Failed to acquire allocator lock");
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
        self.entries.lock().unwrap().insert(id, allocation);
        Ok(id)
    }

    pub fn deallocate_buffer(&self, id: AllocationId) {
        if let Some(allocation) =
            self.entries.lock().expect("Failed to acquire entries lock").remove(&id)
        {
            let mut allocator = self.inner.lock().unwrap();
            allocator.free(allocation).unwrap();
        }
    }

    pub fn deallocate_image(&self, id: AllocationId) {
        if let Some(allocation) =
            self.entries.lock().expect("Failed to acquire entries lock").remove(&id)
        {
            let mut allocator = self.inner.lock().unwrap();
            allocator.free(allocation).unwrap();
        }
    }

    pub(crate) fn get_mapped_ptr(&self, id: AllocationId) -> Result<*mut u8> {
        let entries = self.entries.lock().expect("Failed to acquire entries lock");
        let entry = entries.get(&id).expect("Invalid allocation ID");

        entry
            .mapped_ptr()
            .map(|ptr| ptr.cast::<u8>().as_ptr())
            .ok_or_else(|| anyhow::anyhow!("Buffer is not mapped"))
    }
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "gpu-tests")]
    use {
        super::*,
        crate::test::test_gpu,
        ash::vk::{BufferCreateInfo, BufferUsageFlags, SharingMode},
    };

    #[test]
    #[cfg(feature = "gpu-tests")]
    fn test_allocator_creation() {
        let gpu = test_gpu();
        let allocator = gpu.allocator();
        assert!(!allocator.entries.lock().unwrap().is_empty() == false);
    }

    #[test]
    #[cfg(feature = "gpu-tests")]
    fn test_buffer_allocation_and_deallocation() {
        let gpu = test_gpu();
        let allocator = gpu.allocator();

        let buffer_info = BufferCreateInfo::default()
            .size(1024)
            .usage(BufferUsageFlags::VERTEX_BUFFER)
            .sharing_mode(SharingMode::EXCLUSIVE);

        let buffer = unsafe { gpu.device().handle.create_buffer(&buffer_info, None) }
            .expect("Failed to create buffer");

        let requirements = unsafe { gpu.device().handle.get_buffer_memory_requirements(buffer) };

        let alloc_id = allocator
            .allocate_buffer(
                buffer,
                requirements,
                MemoryLocation::CpuToGpu,
                "test_buffer",
            )
            .expect("Failed to allocate buffer");

        assert!(allocator.entries.lock().unwrap().contains_key(&alloc_id));

        allocator.deallocate_buffer(alloc_id);
        assert!(!allocator.entries.lock().unwrap().contains_key(&alloc_id));

        unsafe { gpu.device().handle.destroy_buffer(buffer, None) };
    }

    #[test]
    #[cfg(feature = "gpu-tests")]
    fn test_image_allocation_and_deallocation() {
        let gpu = test_gpu();
        let allocator = gpu.allocator();

        let image_info = ash::vk::ImageCreateInfo::default()
            .image_type(ash::vk::ImageType::TYPE_2D)
            .format(ash::vk::Format::R8G8B8A8_UNORM)
            .extent(ash::vk::Extent3D {
                width: 256,
                height: 256,
                depth: 1,
            })
            .mip_levels(1)
            .array_layers(1)
            .samples(ash::vk::SampleCountFlags::TYPE_1)
            .tiling(ash::vk::ImageTiling::OPTIMAL)
            .usage(ash::vk::ImageUsageFlags::COLOR_ATTACHMENT)
            .sharing_mode(SharingMode::EXCLUSIVE);

        let image = unsafe { gpu.device().handle.create_image(&image_info, None) }
            .expect("Failed to create image");

        let requirements = unsafe { gpu.device().handle.get_image_memory_requirements(image) };

        let alloc_id = allocator
            .allocate_image(image, requirements, "test_image")
            .expect("Failed to allocate image");

        assert!(allocator.entries.lock().unwrap().contains_key(&alloc_id));

        allocator.deallocate_image(alloc_id);
        assert!(!allocator.entries.lock().unwrap().contains_key(&alloc_id));

        unsafe { gpu.device().handle.destroy_image(image, None) };
    }

    #[test]
    #[cfg(feature = "gpu-tests")]
    fn test_mapped_ptr_access() {
        let gpu = test_gpu();
        let allocator = gpu.allocator();

        let buffer_info = BufferCreateInfo::default()
            .size(1024)
            .usage(BufferUsageFlags::VERTEX_BUFFER)
            .sharing_mode(SharingMode::EXCLUSIVE);

        let buffer = unsafe { gpu.device().handle.create_buffer(&buffer_info, None) }
            .expect("Failed to create buffer");

        let requirements = unsafe { gpu.device().handle.get_buffer_memory_requirements(buffer) };

        let alloc_id = allocator
            .allocate_buffer(
                buffer,
                requirements,
                MemoryLocation::CpuToGpu,
                "mapped_test_buffer",
            )
            .expect("Failed to allocate buffer");

        let ptr = allocator.get_mapped_ptr(alloc_id).expect("Failed to get mapped ptr");
        assert!(!ptr.is_null());

        allocator.deallocate_buffer(alloc_id);
        unsafe { gpu.device().handle.destroy_buffer(buffer, None) };
    }

    #[test]
    #[cfg(feature = "gpu-tests")]
    fn test_allocation_id_uniqueness() {
        let gpu = test_gpu();
        let allocator = gpu.allocator();
        let mut ids = std::collections::HashSet::new();

        for i in 0..10 {
            let buffer_info = BufferCreateInfo::default()
                .size(64)
                .usage(BufferUsageFlags::VERTEX_BUFFER)
                .sharing_mode(SharingMode::EXCLUSIVE);

            let buffer = unsafe { gpu.device().handle.create_buffer(&buffer_info, None) }
                .expect("Failed to create buffer");

            let requirements =
                unsafe { gpu.device().handle.get_buffer_memory_requirements(buffer) };

            let alloc_id = allocator
                .allocate_buffer(
                    buffer,
                    requirements,
                    MemoryLocation::CpuToGpu,
                    format!("unique_test_{}", i),
                )
                .expect("Failed to allocate buffer");

            assert!(ids.insert(alloc_id), "Allocation ID should be unique");

            allocator.deallocate_buffer(alloc_id);
            unsafe { gpu.device().handle.destroy_buffer(buffer, None) };
        }
    }
}
