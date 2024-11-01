use {
    crate::vk::allocator::Allocator,
    anyhow::Result,
    ash::{vk, vk::Handle},
    gpu_allocator::{
        vulkan::{Allocation, AllocationCreateDesc, AllocationScheme},
        MemoryLocation,
    },
    std::{fmt, sync::Arc},
};
pub struct BufferDesc {
    pub size: usize,
    pub usage: BufferUsage,
    pub memory_location: MemoryLocation,
}

pub struct BufferInfo<'a> {
    pub allocator: &'a Arc<Allocator>,
    pub size: usize,
    pub usage: BufferUsage,
    pub memory_location: MemoryLocation,
    pub initial_data: Option<&'a [u8]>,
}

pub struct Buffer {
    pub allocator: Arc<Allocator>,
    pub allocation: Allocation,
    pub inner: vk::Buffer,
    pub size: usize,
    pub usage: BufferUsage,
    pub memory_location: MemoryLocation,
}

#[derive(Clone, Copy, Debug)]
pub enum BufferUsage {
    TransferSource,
    TransferDestination,
    UniformTexel,
    StorageTexel,
    Uniform,
    Storage,
    Index,
    Vertex,
    Indirect,
}

impl Into<vk::BufferUsageFlags> for BufferUsage {
    fn into(self) -> vk::BufferUsageFlags {
        match self {
            BufferUsage::TransferSource => vk::BufferUsageFlags::TRANSFER_SRC,
            BufferUsage::TransferDestination => vk::BufferUsageFlags::TRANSFER_DST,
            BufferUsage::UniformTexel => vk::BufferUsageFlags::UNIFORM_TEXEL_BUFFER,
            BufferUsage::StorageTexel => vk::BufferUsageFlags::STORAGE_TEXEL_BUFFER,
            BufferUsage::Storage => vk::BufferUsageFlags::STORAGE_BUFFER,
            BufferUsage::Uniform => vk::BufferUsageFlags::UNIFORM_BUFFER,
            BufferUsage::Index => vk::BufferUsageFlags::INDEX_BUFFER,
            BufferUsage::Vertex => vk::BufferUsageFlags::VERTEX_BUFFER,
            BufferUsage::Indirect => vk::BufferUsageFlags::INDIRECT_BUFFER,
        }
    }
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
        let device = &info.allocator.device;
        let mut allocator = info.allocator.inner.lock().unwrap();
        let info2 = vk::BufferCreateInfo::default()
            .size(info.size as u64)
            .usage(info.usage.into());
        let buffer = unsafe { device.inner.create_buffer(&info2, None) }?;
        let requirements = unsafe { device.inner.get_buffer_memory_requirements(buffer) };

        let allocation = allocator.allocate(&AllocationCreateDesc {
            name: "Buffer",
            requirements,
            location: info.memory_location,
            linear: true,
            allocation_scheme: AllocationScheme::GpuAllocatorManaged,
        })?;

        unsafe {
            device
                .inner
                .bind_buffer_memory(buffer, allocation.memory(), allocation.offset())
        }?;

        Ok(Self {
            allocator: info.allocator.clone(),
            allocation,
            inner: buffer,
            size: info.size,
            usage: info.usage,
            memory_location: info.memory_location,
        })
    }
}
