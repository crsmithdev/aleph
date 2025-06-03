pub mod allocator;
pub mod buffer;
pub mod command;
pub mod debug;
pub mod device;
pub mod freelist;
pub mod gpu;
pub mod image;
pub mod instance;
pub mod pool;
pub mod swapchain;
pub mod sync;

pub(crate) const TIMEOUT_NS: u64 = 5_000_000_000;

pub use {
    crate::{
        allocator::Allocator,
        buffer::{Buffer, TypedBuffer},
        command::{CommandBuffer, CommandPool},
        device::{Device, Queue, QueueFamily},
        gpu::Gpu,
        image::{Image, Sampler, Texture, TextureInfo},
        instance::Instance,
        pool::ResourcePool,
        swapchain::{Surface, Swapchain, SwapchainInfo},
    },
    ash::vk::{
        AccessFlags2, AttachmentLoadOp, AttachmentStoreOp, ClearColorValue, ClearDepthStencilValue,
        ClearValue, ColorComponentFlags, CommandBufferSubmitInfo, CompareOp, CullModeFlags,
        DescriptorBindingFlags, DescriptorBufferInfo, DescriptorImageInfo, DescriptorPool,
        DescriptorPoolCreateFlags, DescriptorPoolSize, DescriptorSet, DescriptorSetLayout,
        DescriptorSetLayoutBinding, DescriptorSetLayoutBindingFlagsCreateInfo,
        DescriptorSetLayoutCreateFlags, DescriptorType, DeviceAddress, DynamicState, Extent2D,
        Extent3D, Fence, Filter, Format, FrontFace, GraphicsPipelineCreateInfo, Handle,
        ImageAspectFlags, ImageLayout, ImageUsageFlags, MappedMemoryRange, MemoryRequirements,
        Pipeline as VkPipeline, PipelineBindPoint, PipelineColorBlendAttachmentState,
        PipelineColorBlendStateCreateInfo, PipelineDepthStencilStateCreateFlags,
        PipelineDepthStencilStateCreateInfo, PipelineDynamicStateCreateInfo,
        PipelineInputAssemblyStateCreateInfo, PipelineLayout, PipelineMultisampleStateCreateInfo,
        PipelineRasterizationStateCreateInfo, PipelineRenderingCreateInfo,
        PipelineShaderStageCreateInfo, PipelineStageFlags2, PipelineTessellationStateCreateInfo,
        PipelineVertexInputStateCreateInfo, PipelineViewportStateCreateInfo, PolygonMode,
        PrimitiveTopology, PushConstantRange, Rect2D, RenderingAttachmentInfo, SampleCountFlags,
        SamplerAddressMode, SamplerMipmapMode, Semaphore, SemaphoreSubmitInfo, ShaderModule,
        ShaderStageFlags, StencilOpState, SubmitInfo2, VertexInputAttributeDescription,
        VertexInputBindingDescription, Viewport, WriteDescriptorSet,
    },
};

pub mod test {
    use std::sync::{Arc, LazyLock};

    static TEST_GPU: LazyLock<Arc<crate::gpu::Gpu>> =
        LazyLock::new(|| Arc::new(crate::gpu::Gpu::headless().expect("Error creating test GPU")));

    pub fn test_gpu() -> &'static Arc<crate::Gpu> { &TEST_GPU }
}
