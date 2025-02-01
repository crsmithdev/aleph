pub mod vk;

pub(crate) const VK_TIMEOUT_NS: u64 = 5_000_000_000;

pub use {
    ash::vk::{
        BufferUsageFlags,
        DeviceAddress,
        Extent3D,
        Fence,
        Format,
        ImageAspectFlags,
        ImageUsageFlags,
        StencilOpState,
    },
    gpu_allocator::MemoryLocation,
    vk::{
        Allocator,
        Buffer,
        BufferInfo,
        CommandBuffer,
        CommandPool,
        DeletionQueue,
        Device,
        Frame,
        Gpu,
        Image,
        ImageInfo,
        Instance,
        Queue,
        QueueFamily,
        Surface,
        Swapchain,
        SwapchainInfo,
    },
};
