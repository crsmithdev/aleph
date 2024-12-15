use {
    crate::vk::allocator::MemoryAllocator,
    anyhow::Result,
    ash::{vk, vk::Handle},
    gpu_allocator::vulkan::{Allocation, AllocationCreateDesc, AllocationScheme},
    std::{fmt, sync::Arc},
};

// pub struct Buffer {
//     pub allocation: Allocation,
//     pub handle: vk::Buffer,
//     pub size: usize,
//     pub usage: vk::BufferUsageFlags,
//     pub memory_location: gpu_allocator::MemoryLocation,
// }


// impl Buffer {
//     pub fn new(info: &BufferInfo) -> Result<Self> {
//         let mut allocator = info.allocator.inner.lock().unwrap();
//         let info2 = vk::BufferCreateInfo::default()
//             .size(info.size as u64)
//             .usage(info.usage);
//         let buffer = unsafe { info.device.create_buffer(&info2, None) }?;
//         let requirements = unsafe { info.device.get_buffer_memory_requirements(buffer) };

//         let allocation = allocator.allocate(&AllocationCreateDesc {
//             name: "Buffer",
//             requirements,
//             location: info.memory_location,
//             linear: true,
//             allocation_scheme: AllocationScheme::GpuAllocatorManaged,
//         })?;

//         unsafe {
//             info.device
//                 .bind_buffer_memory(buffer, allocation.memory(), allocation.offset())
//         }?;

//         Ok(Self {
//             allocator: info.allocator.clone(),
//             allocation,
//             inner: buffer,
//             size: info.size,
//             usage: info.usage,
//             memory_location: info.memory_location,
//             device: info.device.clone(),
//             physical_device: *info.physical_device,
//         })
//     }
// }
