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

// fn allocate(
//     allocator: &Arc<Mutex<Allocator>>,
//     device: &ash::Device,
//     bytes: usize,
//     flags: vk::BufferUsageFlags,
//     location: MemoryLocation,
// ) -> Result<(vk::Buffer, Allocation)> {
//     let mut allocator = allocator.lock().unwrap();
//     let info = vk::BufferCreateInfo::default()
//         .size(bytes as u64)
//         .usage(flags);
//     let buffer = unsafe { device.create_buffer(&info, None) }?;
//     let requirements = unsafe { device.get_buffer_memory_requirements(buffer) };

//     let allocation = allocator.allocate(&AllocationCreateDesc {
//         name: "Buffer",
//         requirements,
//         location,
//         linear: true,
//         allocation_scheme: AllocationScheme::GpuAllocatorManaged,
//     })?;

//     unsafe { device.bind_buffer_memory(buffer, allocation.memory(), allocation.offset()) }?;

//     Ok((buffer, allocation))
// }

// pub fn create_command_buffer(&self) -> CommandBuffer {
//     let command_buffer_allocate_info = vk::CommandBufferAllocateInfo::default()
//         .command_buffer_count(1)
//         .command_pool(self.command_pool)
//         .level(vk::CommandBufferLevel::PRIMARY);

//     Self::allocate_command_buffer(self.inner.clone(), command_buffer_allocate_info)
// }

// pub fn create_buffer<T>(&self, desc: BufferDesc, initial_data: Option<&[T]>) ->
// Result<Buffer> {     let mut flags: vk::BufferUsageFlags = desc.usage.into();
//     if initial_data.is_some() {
//         flags |= vk::BufferUsageFlags::TRANSFER_DST;
//     }
//     let initial_data = initial_data.unwrap();
//     let size = initial_data.len() * size_of::<T>();
//     let (buffer, allocation) = allocate(
//         &self.allocator,
//         &self.inner,
//         size,
//         flags,
//         MemoryLocation::CpuToGpu,
//     )
//     .unwrap();

//     self.write_buffer(&allocation, initial_data)?;
//     Ok(Buffer {
//         inner: buffer,
//         allocation,
//     })
// }

// pub fn write_buffer<T: Sized>(&self, allocation: &Allocation, data: &[T]) -> Result<()> {
//     let buffer_ptr = allocation.mapped_ptr().unwrap().cast().as_ptr();
//     unsafe { ptr::copy_nonoverlapping(data.as_ptr(), buffer_ptr, data.len()) }

//     Ok(())
// }

// fn find_memorytype_index(
//     &self,
//     memory_req: &vk::MemoryRequirements,
//     memory_prop: &vk::PhysicalDeviceMemoryProperties,
//     flags: vk::MemoryPropertyFlags,
// ) -> Option<u32> {
//     memory_prop.memory_types[..memory_prop.memory_type_count as _]
//         .iter()
//         .enumerate()
//         .find(|(index, memory_type)| {
//             (1 << index) & memory_req.memory_type_bits != 0
//                 && memory_type.property_flags & flags == flags
//         })
//         .map(|(index, _memory_type)| index as _)
// }
