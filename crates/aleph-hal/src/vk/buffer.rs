pub use gpu_allocator::MemoryLocation;
use {
    ash::{vk, vk::Handle},
    gpu_allocator::vulkan::Allocation,
    std::fmt,
};
pub struct BufferDesc {
    pub size: usize,
    pub usage: BufferUsage,
    pub memory_location: MemoryLocation,
}

pub struct Buffer {
    pub allocation: Allocation,
    pub inner: vk::Buffer,
}

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
