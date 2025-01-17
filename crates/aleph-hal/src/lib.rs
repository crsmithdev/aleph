pub mod vk;

pub(crate) const VK_TIMEOUT_NS: u64 = 5_000_000_000;

pub use {
    ash::vk::{DeviceAddress, Fence},
    vk::{
        Buffer,
        BufferInfo,
        CommandBuffer,
        CommandPool,
        Context,
        Device,
        Frame,
        Image,
        ImageInfo,
        Instance,
        MemoryAllocator,
        Queue,
        QueueFamily,
        Surface,
        Swapchain,
        SwapchainInfo,
    },
};
