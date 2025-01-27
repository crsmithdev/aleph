pub mod vk;

pub(crate) const VK_TIMEOUT_NS: u64 = 5_000_000_000;

pub use {
    ash::vk::{DeviceAddress, Extent3D, Fence, Format, ImageUsageFlags, ImageAspectFlags, StencilOpState},
    vk::{
        Allocator,
        Buffer,
        BufferInfo,
        BufferUsageFlags,
        CommandBuffer,
        CommandPool,
        DeletionQueue,
        Gpu,
        Device,
        Frame,
        Image,
        ImageInfo,
        Instance,
        MemoryLocation,
        Queue,
        QueueFamily,
        Surface,
        Swapchain,
        SwapchainInfo,
    },
};
