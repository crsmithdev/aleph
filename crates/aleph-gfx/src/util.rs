pub use ash::vk::{
    AttachmentLoadOp, AttachmentStoreOp, DescriptorSetLayoutBinding, ShaderStageFlags,
};
use {
    crate::vk::{Gpu, Image},
    anyhow::Result,
    ash::{
        vk,
        vk::{ClearDepthStencilValue, ClearValue, CompareOp, StencilOpState},
    },
    std::ffi::CStr,
};

const SHADER_MAIN: &CStr = c"main";
pub const DYNAMIC_STATES: [vk::DynamicState; 2] =
    [vk::DynamicState::VIEWPORT, vk::DynamicState::SCISSOR];

pub fn load_shader<'a>(
    path: &str,
    gpu: &Gpu,
    flags: ShaderStageFlags,
) -> Result<(vk::ShaderModule, vk::PipelineShaderStageCreateInfo<'a>)> {
    let module = gpu.create_shader_module(path)?;
    let stage_info = vk::PipelineShaderStageCreateInfo::default()
        .module(module)
        .name(SHADER_MAIN)
        .stage(flags);
    Ok((module, stage_info))
}

pub fn color_attachment<'a>(image: &Image) -> vk::RenderingAttachmentInfo<'a> {
    vk::RenderingAttachmentInfo::default()
        .image_view(image.view)
        .image_layout(vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL)
        .load_op(AttachmentLoadOp::CLEAR)
        .store_op(AttachmentStoreOp::STORE)
}

pub fn depth_attachment<'a>(image: &Image) -> vk::RenderingAttachmentInfo<'a> {
    vk::RenderingAttachmentInfo::default()
        .image_view(image.view)
        .image_layout(vk::ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL)
        .clear_value(ClearValue {
            depth_stencil: ClearDepthStencilValue {
                depth: 1.0,
                stencil: 0,
            },
        })
        .load_op(AttachmentLoadOp::CLEAR)
        .store_op(AttachmentStoreOp::DONT_CARE)
}

pub fn clear_value(depth: f32, stencil: u32) -> vk::ClearValue {
    vk::ClearValue {
        depth_stencil: vk::ClearDepthStencilValue { depth, stencil },
    }
}

pub fn buffer_binding<'a>(
    index: u32,
    stage_flags: vk::ShaderStageFlags,
) -> DescriptorSetLayoutBinding<'a> {
    DescriptorSetLayoutBinding::default()
        .binding(index)
        .descriptor_type(vk::DescriptorType::UNIFORM_BUFFER)
        .descriptor_count(1)
        .stage_flags(stage_flags)
}

pub fn texture_binding<'a>(
    index: u32,
    stage_flags: vk::ShaderStageFlags,
) -> DescriptorSetLayoutBinding<'a> {
    DescriptorSetLayoutBinding::default()
        .binding(index)
        .descriptor_type(vk::DescriptorType::COMBINED_IMAGE_SAMPLER)
        .descriptor_count(1)
        .stage_flags(stage_flags)
}

pub fn descriptor_layout_binding<'a>(
    index: u32,
    descriptor_type: vk::DescriptorType,
    stage_flags: vk::ShaderStageFlags,
) -> DescriptorSetLayoutBinding<'a> {
    DescriptorSetLayoutBinding::default()
        .binding(index)
        .descriptor_type(descriptor_type)
        .descriptor_count(1)
        .stage_flags(stage_flags)
}
/*
    let color_blend_attachments = &[vk::PipelineColorBlendAttachmentState::default()
//             .blend_enable(false)
//             .color_write_mask(
//                 vk::ColorComponentFlags::A
//                     | vk::ColorComponentFlags::R
//                     | vk::ColorComponentFlags::G
//                     | vk::ColorComponentFlags::B,
//             )];
 */

pub fn color_blend_disabled(
    attachments: &[vk::PipelineColorBlendAttachmentState],
) -> vk::PipelineColorBlendStateCreateInfo {
    vk::PipelineColorBlendStateCreateInfo::default()
        .logic_op_enable(false)
        .attachments(attachments)
}

pub trait PipelineColorBlendAttachmentStateExt {
    fn disabled() -> Self;
}

pub type PipelineColorBlendAttachment = vk::PipelineColorBlendAttachmentState;
impl PipelineColorBlendAttachmentStateExt for PipelineColorBlendAttachment {
    fn disabled() -> Self {
        Self::default()
            .blend_enable(false)
            .color_write_mask(
                vk::ColorComponentFlags::A
                    | vk::ColorComponentFlags::R
                    | vk::ColorComponentFlags::G
                    | vk::ColorComponentFlags::B,
            )
    }
}

pub trait PipelineColorBlendStateCreateInfoExt {
    fn disabled(attachments: &[vk::PipelineColorBlendAttachmentState]) -> vk::PipelineColorBlendStateCreateInfo<'_>;
}
pub type PipelineColorBlend<'a> = vk::PipelineColorBlendStateCreateInfo<'a>;
impl PipelineColorBlendStateCreateInfoExt for PipelineColorBlend<'_> {
    fn disabled(attachments: &[vk::PipelineColorBlendAttachmentState]) -> vk::PipelineColorBlendStateCreateInfo<'_> {
        vk::PipelineColorBlendStateCreateInfo::default()
            .logic_op_enable(false)
            .attachments(attachments)
    }
}


pub trait PipelineInputAssemblyStateCreateInfoExt {
    fn triangle_list() -> Self;
}
pub type PipelineInput<'a> = vk::PipelineInputAssemblyStateCreateInfo<'a>;
impl PipelineInputAssemblyStateCreateInfoExt for PipelineInput<'_> {
    fn triangle_list() -> Self {
        Self::default().topology(vk::PrimitiveTopology::TRIANGLE_LIST)
    }
}

pub trait PipelineMultisampleStateCreateInfoExt {
    fn disabled() -> Self;
}
pub type PipelineMultisampling<'a> = vk::PipelineMultisampleStateCreateInfo<'a>;
impl PipelineMultisampleStateCreateInfoExt for PipelineMultisampling<'_> {
    fn disabled() -> Self {
        Self::default().rasterization_samples(vk::SampleCountFlags::TYPE_1)
    }
}

pub trait PipelineDynamicStateCreateInfoExt {
    fn viewport_and_scissor() -> Self;
}

pub type PipelineDynamicState<'a> = vk::PipelineDynamicStateCreateInfo<'a>;
impl PipelineDynamicStateCreateInfoExt for PipelineDynamicState<'_> {
    fn viewport_and_scissor() -> Self {
        Self::default().dynamic_states(&[vk::DynamicState::VIEWPORT, vk::DynamicState::SCISSOR])
    }   
}

pub trait PipelineViewportStateCreateInfoExt {
    fn single_viewport_scissor() -> Self;
}

pub type PipelineViewport<'a> = vk::PipelineViewportStateCreateInfo<'a>;
impl PipelineViewportStateCreateInfoExt for PipelineViewport<'_> {
    fn single_viewport_scissor() -> Self {
        Self::default().viewport_count(1).scissor_count(1)
    }
}

pub trait PipelineRasterizationStateCreateInfoExt {
    fn filled(cull_mode: vk::CullModeFlags, front_face: vk::FrontFace) -> Self;
}

pub type PipelineRasterization<'a> = vk::PipelineRasterizationStateCreateInfo<'a>;
impl PipelineRasterizationStateCreateInfoExt for PipelineRasterization<'_> {
    fn filled(cull_mode: vk::CullModeFlags, front_face: vk::FrontFace) -> Self {
        Self::default()
            .polygon_mode(vk::PolygonMode::FILL)
            .cull_mode(cull_mode)
            .front_face(front_face)
            .line_width(1.0)
            .depth_bias_enable(true)
            .depth_bias_constant_factor(4.0)
            .depth_bias_slope_factor(1.5)
            // .depth_clamp_enable(true)
    }
}
pub trait PipelineDepthStencilStateCreateInfoExt {
    fn enabled(compare_op: CompareOp) -> Self;
    fn disabled() -> Self;
}

pub type PipelineDepthStencil<'a> = vk::PipelineDepthStencilStateCreateInfo<'a>;
impl<'a> PipelineDepthStencilStateCreateInfoExt for PipelineDepthStencil<'a> {
    fn enabled(compare_op: CompareOp) -> Self {
        let mut info = Self::default()
            .depth_test_enable(true)
            .depth_write_enable(true)
            .depth_compare_op(compare_op)
            .min_depth_bounds(0.)
            .max_depth_bounds(1.);
        info.back = StencilOpState::default().compare_op(vk::CompareOp::ALWAYS);
        info
    }

    fn disabled() -> Self {
        Self::default()
            .depth_test_enable(false)
            .depth_write_enable(false)
            .depth_compare_op(vk::CompareOp::LESS_OR_EQUAL)
    }
}
