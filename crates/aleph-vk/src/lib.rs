pub mod allocator;
pub mod buffer;
pub mod command;
pub mod debug;
pub mod device;
pub mod gpu;
pub mod instance;
pub mod pool;
pub mod swapchain;
pub mod sync;
pub mod texture;

pub(crate) const TIMEOUT_NS: u64 = 20_000_000_000;

#[cfg(test)]
pub use test::test_gpu;
pub use {
    crate::{
        allocator::Allocator,
        buffer::{Buffer, BufferUsageFlags, MemoryLocation, TypedBuffer},
        command::{CommandBuffer, CommandPool},
        device::{Device, Queue, QueueFamily},
        gpu::Gpu,
        instance::Instance,
        pool::ResourcePool,
        swapchain::{Surface, Swapchain, SwapchainInfo},
        texture::{Image, Texture, TextureInfo},
    },
    ash::vk::{
        AccessFlags2, AttachmentLoadOp, AttachmentStoreOp, ClearColorValue, ClearDepthStencilValue,
        ClearValue, ColorComponentFlags, CommandBufferSubmitInfo, CompareOp, CullModeFlags,
        DescriptorBindingFlags, DescriptorBufferInfo, DescriptorImageInfo, DescriptorPool,
        DescriptorPoolCreateFlags, DescriptorPoolSize, DescriptorSet, DescriptorSetLayout,
        DescriptorSetLayoutBinding, DescriptorSetLayoutBindingFlagsCreateInfo,
        DescriptorSetLayoutCreateFlags, DescriptorType, DeviceAddress, DynamicState, Extent2D,
        Extent3D, Fence, Filter, Format, FrontFace, GraphicsPipelineCreateInfo, Handle,
        ImageAspectFlags, ImageLayout, ImageUsageFlags, MemoryRequirements, Pipeline as VkPipeline,
        PipelineBindPoint, PipelineColorBlendAttachmentState, PipelineColorBlendStateCreateInfo,
        PipelineDepthStencilStateCreateFlags, PipelineDepthStencilStateCreateInfo,
        PipelineDynamicStateCreateInfo, PipelineInputAssemblyStateCreateInfo, PipelineLayout,
        PipelineMultisampleStateCreateInfo, PipelineRasterizationStateCreateInfo,
        PipelineRenderingCreateInfo, PipelineShaderStageCreateInfo, PipelineStageFlags2,
        PipelineTessellationStateCreateInfo, PipelineVertexInputStateCreateInfo,
        PipelineViewportStateCreateInfo, PolygonMode, PrimitiveTopology, PushConstantRange, Rect2D,
        RenderingAttachmentInfo, SampleCountFlags, Sampler, SamplerAddressMode, SamplerMipmapMode,
        Semaphore, SemaphoreSubmitInfo, ShaderModule, ShaderStageFlags, StencilOpState,
        SubmitInfo2, VertexInputAttributeDescription, VertexInputBindingDescription, Viewport,
        WriteDescriptorSet,
    },
};

#[cfg(test)]
#[allow(dead_code)]
mod test {
    use std::sync::{Arc, LazyLock};

    static TEST_GPU: LazyLock<Arc<crate::Gpu>> =
        LazyLock::new(|| Arc::new(crate::Gpu::headless().expect("Error creating test GPU")));

    pub fn test_gpu() -> &'static Arc<crate::Gpu> { &TEST_GPU }
}
