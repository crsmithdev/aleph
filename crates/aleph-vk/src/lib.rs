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
        texture::{AllocatedTexture, SamplerDesc, Texture, TextureDesc, WrappedTexture},
    },
    ash::vk::{
        AttachmentLoadOp, AttachmentStoreOp, ClearColorValue, ClearDepthStencilValue, ClearValue,
        ColorComponentFlags, CompareOp, CullModeFlags, DescriptorBufferInfo, DescriptorImageInfo,
        DescriptorSetLayout, DescriptorSetLayoutBinding, DescriptorSetLayoutCreateFlags,
        DescriptorType, DeviceAddress, DynamicState, Extent2D, Extent3D, Fence, Filter, Format,
        FrontFace, GraphicsPipelineCreateInfo, Handle, ImageAspectFlags, ImageLayout,
        ImageUsageFlags, MemoryRequirements, Pipeline as VkPipeline, PipelineBindPoint,
        PipelineColorBlendAttachmentState, PipelineColorBlendStateCreateInfo,
        PipelineDepthStencilStateCreateFlags, PipelineDepthStencilStateCreateInfo,
        PipelineDynamicStateCreateInfo, PipelineInputAssemblyStateCreateInfo, PipelineLayout,
        PipelineMultisampleStateCreateInfo, PipelineRasterizationStateCreateInfo,
        PipelineRenderingCreateInfo, PipelineShaderStageCreateInfo,
        PipelineTessellationStateCreateInfo, PipelineVertexInputStateCreateInfo,
        PipelineViewportStateCreateInfo, PolygonMode, PrimitiveTopology, Rect2D,
        RenderingAttachmentInfo, SampleCountFlags, Sampler, SamplerAddressMode, SamplerMipmapMode,
        ShaderModule, ShaderStageFlags, StencilOpState, VertexInputAttributeDescription,
        VertexInputBindingDescription, Viewport, WriteDescriptorSet,
    },
};
