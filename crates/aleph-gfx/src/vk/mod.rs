pub mod allocator;
pub mod buffer;
pub mod command;
pub mod device;
pub mod gpu;
pub mod image;
pub mod instance;
pub mod swapchain;
pub mod pipeline;

pub(crate) const VK_TIMEOUT_NS: u64 = 5_000_000_000;

pub use {
    crate::vk::{
        allocator::Allocator,
        pipeline::PipelineBuilder,
        buffer::{Buffer, BufferUsageFlags, RawBuffer, MemoryLocation},
        command::{CommandBuffer, CommandPool},
        device::{Device, Queue, QueueFamily},
        gpu::{Gpu, Surface},
        image::{Texture, ImageAspectFlags,  ImageUsageFlags},
        instance::Instance,
        swapchain::{Frame, Swapchain, SwapchainInfo},
    },
    ash::vk::{
        AttachmentLoadOp,
        AttachmentStoreOp,
        ClearDepthStencilValue,
        ClearValue,
        ColorComponentFlags,
        CullModeFlags,
        DescriptorBufferInfo,
        DescriptorSetLayout,
        DescriptorSetLayoutCreateFlags,
        DescriptorType,
        DeviceAddress,
        Extent2D,
        Extent3D,
        Fence,
        Format,
        FrontFace,
        GraphicsPipelineCreateInfo,
        ImageLayout,
        Pipeline,
        PipelineBindPoint,
        PipelineColorBlendAttachmentState,
        PipelineLayout,
        PipelineRenderingCreateInfo,
        PipelineVertexInputStateCreateInfo,
        Rect2D,
        RenderingAttachmentInfo,
        StencilOpState,
        VertexInputAttributeDescription,
        VertexInputBindingDescription,
        Viewport,
        WriteDescriptorSet,
    },
};

// pub trait Extent2DExt {
//     fn into_3d(self) -> Extent3D;
// }

// impl Extent2DExt for Extent2D {
//     fn into_3d(self) -> Extent3D {
//         Extent3D {
//             width: self.width,
//             height: self.height,
//             depth: 1,
//         }
//     }
// }