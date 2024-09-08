use {ash::vk, gpu_allocator::MemoryLocation};

struct BufferDesc {
    usage: vk::BufferUsageFlags,
    index_type: vk::IndexType,
    memory_location: MemoryLocation,
    linear: bool,
    sharing_mode: vk::SharingMode,
}

struct Buffer {
    desc: BufferDesc,
}

pub enum BufferType {
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

impl Into<vk::BufferUsageFlags> for BufferType {
    fn into(self) -> vk::BufferUsageFlags {
        match self {
            BufferType::TransferSource => vk::BufferUsageFlags::TRANSFER_SRC,
            BufferType::TransferDestination => vk::BufferUsageFlags::TRANSFER_DST,
            BufferType::UniformTexel => vk::BufferUsageFlags::UNIFORM_TEXEL_BUFFER,
            BufferType::StorageTexel => vk::BufferUsageFlags::STORAGE_TEXEL_BUFFER,
            BufferType::Storage => vk::BufferUsageFlags::STORAGE_BUFFER,
            BufferType::Uniform => vk::BufferUsageFlags::UNIFORM_BUFFER,
            BufferType::Index => vk::BufferUsageFlags::INDEX_BUFFER,
            BufferType::Vertex => vk::BufferUsageFlags::VERTEX_BUFFER,
            BufferType::Indirect => vk::BufferUsageFlags::INDIRECT_BUFFER,
        }
    }
}
