pub mod allocator;
pub mod buffer;
pub mod command;
pub mod device;
pub mod gpu;
pub mod instance;
pub mod swapchain;
pub mod texture;

pub(crate) const VK_TIMEOUT_NS: u64 = 5_000_000_000;

pub use {
    crate::{
        allocator::Allocator,
        buffer::{Buffer, BufferUsageFlags, MemoryLocation, RawBuffer},
        command::{CommandBuffer, CommandPool},
        device::{Device, Queue, QueueFamily},
        gpu::{Gpu, Surface},
        instance::Instance,
        swapchain::{Frame, Swapchain, SwapchainInfo},
        texture::{AllocatedTexture, ImageAspectFlags, ImageUsageFlags, Texture, WrappedTexture},
    },
    ash::vk::{
        AttachmentLoadOp, AttachmentStoreOp, ClearDepthStencilValue, ClearValue,
        ColorComponentFlags, CompareOp, CullModeFlags, DescriptorBufferInfo, DescriptorSetLayout,
        DescriptorSetLayoutBinding, DescriptorSetLayoutCreateFlags, DescriptorType, DeviceAddress,
        Extent2D, Extent3D, Fence, Filter, Format, FrontFace, GraphicsPipelineCreateInfo, Handle,
        ImageLayout, Pipeline as VkPipeline, PipelineBindPoint, PipelineColorBlendAttachmentState,
        PipelineLayout, PipelineRenderingCreateInfo, PipelineVertexInputStateCreateInfo,
        PolygonMode, PrimitiveTopology, Rect2D, RenderingAttachmentInfo, Sampler,
        SamplerAddressMode, SamplerMipmapMode, ShaderStageFlags, StencilOpState,
        VertexInputAttributeDescription, VertexInputBindingDescription, Viewport,
        WriteDescriptorSet,
    },
};
