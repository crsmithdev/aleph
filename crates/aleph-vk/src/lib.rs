pub mod allocator;
pub mod buffer;
pub mod command;
pub mod device;
pub mod gpu;
pub mod image;
pub mod instance;
pub mod swapchain;

pub(crate) const VK_TIMEOUT_NS: u64 = 5_000_000_000;

pub use {
    crate::{
        allocator::Allocator,
        buffer::{Buffer, BufferUsageFlags, MemoryLocation, RawBuffer},
        command::{CommandBuffer, CommandPool},
        device::{Device, Queue, QueueFamily},
        gpu::{Gpu, Surface},
        image::{ImageAspectFlags, ImageUsageFlags, Texture},
        instance::Instance,
        swapchain::{Frame, Swapchain, SwapchainInfo},
    },
    ash::vk::{
        AttachmentLoadOp, AttachmentStoreOp, ClearDepthStencilValue, ClearValue,
        ColorComponentFlags, CompareOp, CullModeFlags, DescriptorBufferInfo, DescriptorSetLayout,
        DescriptorSetLayoutBinding, DescriptorSetLayoutCreateFlags, DescriptorType, DeviceAddress,
        Extent2D, Extent3D, Fence, Filter, Format, FrontFace, GraphicsPipelineCreateInfo, Handle,
        ImageLayout, Pipeline as VkPipeline, PipelineBindPoint, PipelineColorBlendAttachmentState,
        PipelineLayout, PipelineRenderingCreateInfo, PipelineVertexInputStateCreateInfo,
        PolygonMode, PrimitiveTopology, Rect2D, RenderingAttachmentInfo, Sampler,
        SamplerMipmapMode, ShaderStageFlags, StencilOpState, VertexInputAttributeDescription,
        VertexInputBindingDescription, Viewport, WriteDescriptorSet,
    },
};
