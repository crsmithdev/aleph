pub mod vk;

pub(crate) const VK_TIMEOUT_NS: u64 = 5_000_000_000;

pub use {
    ash::vk::{
        DeviceAddress,
        Extent3D,
        Extent2D,
        Fence,
        Format,
        StencilOpState,
    },
    vk::{
        allocator::Allocator,
        buffer::{Buffer, BufferInfo, BufferUsageFlags, MemoryLocation},
        command::{CommandBuffer, CommandPool, ImageLayout},
        deletion::DeletionQueue,
        device::{Device, Queue, QueueFamily},
        gpu::{Gpu, Surface},
        image::{Image, ImageInfo, ImageUsageFlags, ImageAspectFlags},
        instance::Instance,
        swapchain::{Frame, Swapchain, SwapchainInfo},
    },
};
