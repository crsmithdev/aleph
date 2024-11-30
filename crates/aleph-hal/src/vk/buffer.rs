use {
    crate::vk::allocator::Allocator,
    anyhow::Result,
    ash::{vk, vk::Handle},
    gpu_allocator::vulkan::{Allocation, AllocationCreateDesc, AllocationScheme},
    std::{fmt, sync::Arc},
};
pub struct BufferInfo<'a> {
    pub allocator: &'a Arc<Allocator>,
    pub device: &'a ash::Device,
    pub physical_device: &'a vk::PhysicalDevice,
    pub size: usize,
    pub usage: vk::BufferUsageFlags,
    pub memory_location: gpu_allocator::MemoryLocation,
    pub initial_data: Option<&'a [u8]>,
}

pub struct Buffer {
    pub allocator: Arc<Allocator>,
    pub allocation: Allocation,
    pub device: ash::Device,
    pub physical_device: vk::PhysicalDevice,
    pub inner: vk::Buffer,
    pub size: usize,
    pub usage: vk::BufferUsageFlags,
    pub memory_location: gpu_allocator::MemoryLocation,
}

impl fmt::Debug for Buffer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Buffer")
            .field("inner", &format_args!("{:x}", self.inner.as_raw()))
            .finish_non_exhaustive()
    }
}

impl Buffer {
    pub fn new(info: &BufferInfo) -> Result<Self> {
        let mut allocator = info.allocator.inner.lock().unwrap();
        let info2 = vk::BufferCreateInfo::default()
            .size(info.size as u64)
            .usage(info.usage);
        let buffer = unsafe { info.device.create_buffer(&info2, None) }?;
        let requirements = unsafe { info.device.get_buffer_memory_requirements(buffer) };

        let allocation = allocator.allocate(&AllocationCreateDesc {
            name: "Buffer",
            requirements,
            location: info.memory_location,
            linear: true,
            allocation_scheme: AllocationScheme::GpuAllocatorManaged,
        })?;

        unsafe {
            info.device
                .bind_buffer_memory(buffer, allocation.memory(), allocation.offset())
        }?;

        Ok(Self {
            allocator: info.allocator.clone(),
            allocation,
            inner: buffer,
            size: info.size,
            usage: info.usage,
            memory_location: info.memory_location,
            device: info.device.clone(),
            physical_device: *info.physical_device,
        })
    }
}
