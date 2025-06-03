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

        self.entries.lock().expect("Failed to acquire entries lock").insert(id, entry);
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
        let entry = AllocEntry {
            allocation,
            buffer: None,
            image: Some(image),
        };

        self.entries.lock().unwrap().insert(id, entry);
        Ok(id)
    }

    pub fn deallocate(&self, id: AllocationId) {
        if let Some(entry) =
            self.entries.lock().expect("Failed to acquire entries lock").remove(&id)
        {
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
        let entries = self.entries.lock().expect("Failed to acquire entries lock");
        entries
            .get(&id)
            .and_then(|entry| entry.buffer)
            .expect("Invalid buffer allocation ID")
    }

    pub fn get_image(&self, id: AllocationId) -> VkImage {
        let entries = self.entries.lock().expect("Failed to acquire entries lock");
        entries.get(&id).and_then(|entry| entry.image).expect("Invalid image allocation ID")
    }

    pub fn get_mapped_ptr(&self, id: AllocationId) -> Result<*mut u8> {
        let entries = self.entries.lock().expect("Failed to acquire entries lock");
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
    #[cfg(feature = "gpu-tests")]
    use assay::assay;
    use {
        super::*,
        crate::test::with_test_gpu,
        ash::vk::{BufferCreateInfo, BufferUsageFlags, SharingMode},
    };

    #[assay]
    #[cfg(feature = "gpu-tests")]
    fn test_buffer_allocation() {
        with_test_gpu(|gpu| {
            let allocator = gpu.allocator();

            let create_info = BufferCreateInfo::default()
                .size(1024)
                .usage(BufferUsageFlags::VERTEX_BUFFER)
                .sharing_mode(SharingMode::EXCLUSIVE);

            let buffer = unsafe { gpu.device().handle.create_buffer(&create_info, None) }
                .expect("Failed to create buffer");
            let requirements =
                unsafe { gpu.device().handle.get_buffer_memory_requirements(buffer) };

            let id = allocator
                .allocate_buffer(buffer, requirements, MemoryLocation::CpuToGpu, "test")
                .expect("Failed to allocate buffer");

            let handle = allocator.get_buffer(id);
            assert_eq!(handle, buffer);
        });
    }

    #[assay]
    #[cfg(feature = "gpu-tests")]
    fn test_buffer_write() {
        with_test_gpu(|gpu| {
            let allocator = gpu.allocator();

            let create_info = BufferCreateInfo::default()
                .size(64)
                .usage(BufferUsageFlags::UNIFORM_BUFFER)
                .sharing_mode(SharingMode::EXCLUSIVE);

            let buffer = unsafe { gpu.device().handle.create_buffer(&create_info, None) }
                .expect("Failed to create buffer");
            let requirements =
                unsafe { gpu.device().handle.get_buffer_memory_requirements(buffer) };

            let id = allocator
                .allocate_buffer(buffer, requirements, MemoryLocation::CpuToGpu, "write_test")
                .expect("Failed to allocate buffer");

            let data: [u32; 4] = [10, 20, 30, 40];
            allocator.write_buffer(id, 0, &data).expect("Failed to write buffer");
        });
    }

    #[assay]
    #[cfg(feature = "gpu-tests")]
    fn test_image_allocation() {
        with_test_gpu(|gpu| {
            let allocator = gpu.allocator();

            let create_info = ash::vk::ImageCreateInfo::default()
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
                .sharing_mode(ash::vk::SharingMode::EXCLUSIVE);

            let image = unsafe { gpu.device().handle.create_image(&create_info, None) }
                .expect("Failed to create image");
            let requirements = unsafe { gpu.device().handle.get_image_memory_requirements(image) };

            let id = allocator
                .allocate_image(image, requirements, "test_image")
                .expect("Failed to allocate image");

            let handle = allocator.get_image(id);
            assert_eq!(handle, image);
        });
    }

    #[assay]
    #[cfg(feature = "gpu-tests")]
    fn test_deallocate_buffer() {
        with_test_gpu(|gpu| {
            let allocator = gpu.allocator();

            let create_info = BufferCreateInfo::default()
                .size(512)
                .usage(BufferUsageFlags::STORAGE_BUFFER)
                .sharing_mode(SharingMode::EXCLUSIVE);

            let buffer = unsafe { gpu.device().handle.create_buffer(&create_info, None) }
                .expect("Failed to create buffer");
            let requirements =
                unsafe { gpu.device().handle.get_buffer_memory_requirements(buffer) };

            let id = allocator
                .allocate_buffer(
                    buffer,
                    requirements,
                    MemoryLocation::CpuToGpu,
                    "dealloc_test",
                )
                .expect("Failed to allocate buffer");

            allocator.deallocate(id);

            std::panic::catch_unwind(|| allocator.get_buffer(id))
                .expect_err("Should panic on invalid ID");
        });
    }

    #[assay]
    #[cfg(feature = "gpu-tests")]
    fn test_deallocate_image() {
        with_test_gpu(|gpu| {
            let allocator = gpu.allocator();

            let create_info = ash::vk::ImageCreateInfo::default()
                .image_type(ash::vk::ImageType::TYPE_2D)
                .format(ash::vk::Format::R8G8B8A8_UNORM)
                .extent(ash::vk::Extent3D {
                    width: 128,
                    height: 128,
                    depth: 1,
                })
                .mip_levels(1)
                .array_layers(1)
                .samples(ash::vk::SampleCountFlags::TYPE_1)
                .tiling(ash::vk::ImageTiling::OPTIMAL)
                .usage(ash::vk::ImageUsageFlags::SAMPLED)
                .sharing_mode(ash::vk::SharingMode::EXCLUSIVE);

            let image = unsafe { gpu.device().handle.create_image(&create_info, None) }
                .expect("Failed to create image");
            let requirements = unsafe { gpu.device().handle.get_image_memory_requirements(image) };

            let id = allocator
                .allocate_image(image, requirements, "dealloc_image_test")
                .expect("Failed to allocate image");

            allocator.deallocate(id);

            std::panic::catch_unwind(|| allocator.get_image(id))
                .expect_err("Should panic on invalid ID");
        });
    }

    #[assay]
    #[cfg(feature = "gpu-tests")]
    fn test_multiple_allocations() {
        with_test_gpu(|gpu| {
            let allocator = gpu.allocator();

            let mut ids = Vec::new();

            for i in 0..5 {
                let create_info = BufferCreateInfo::default()
                    .size(256 * (i + 1))
                    .usage(BufferUsageFlags::VERTEX_BUFFER)
                    .sharing_mode(SharingMode::EXCLUSIVE);

                let buffer = unsafe { gpu.device().handle.create_buffer(&create_info, None) }
                    .expect("Failed to create buffer");
                let requirements =
                    unsafe { gpu.device().handle.get_buffer_memory_requirements(buffer) };

                let id = allocator
                    .allocate_buffer(
                        buffer,
                        requirements,
                        MemoryLocation::CpuToGpu,
                        format!("multi_{}", i),
                    )
                    .expect("Failed to allocate buffer");

                ids.push(id);
            }

            for id in &ids {
                allocator.get_buffer(*id);
            }

            for id in ids {
                allocator.deallocate(id);
            }
        });
    }

    #[assay]
    #[cfg(feature = "gpu-tests")]
    fn test_write_buffer_offset() {
        with_test_gpu(|gpu| {
            let allocator = gpu.allocator();

            let create_info = BufferCreateInfo::default()
                .size(128)
                .usage(BufferUsageFlags::UNIFORM_BUFFER)
                .sharing_mode(SharingMode::EXCLUSIVE);

            let buffer = unsafe { gpu.device().handle.create_buffer(&create_info, None) }
                .expect("Failed to create buffer");
            let requirements =
                unsafe { gpu.device().handle.get_buffer_memory_requirements(buffer) };

            let id = allocator
                .allocate_buffer(
                    buffer,
                    requirements,
                    MemoryLocation::CpuToGpu,
                    "offset_test",
                )
                .expect("Failed to allocate buffer");

            let data1: [u32; 2] = [100, 200];
            let data2: [u32; 2] = [300, 400];

            allocator.write_buffer(id, 0, &data1).expect("Failed to write at offset 0");
            allocator.write_buffer(id, 8, &data2).expect("Failed to write at offset 8");
        });
    }
}
