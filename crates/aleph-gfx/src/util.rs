pub use ash::vk::{
    AttachmentLoadOp,
    AttachmentStoreOp,
    DescriptorSetLayoutBinding,
    ShaderStageFlags,
};
use crate::vk::Gpu;

use {
    crate::vk::{ Image},
    anyhow::Result,
    ash::vk,
    std::ffi::CStr,
};

const SHADER_MAIN: &CStr = c"main" ;
pub const DYNAMIC_STATES: [vk::DynamicState; 2] =
    [vk::DynamicState::VIEWPORT, vk::DynamicState::SCISSOR];

pub fn load_shader<'a>(path: &str, gpu: &Gpu, flags: ShaderStageFlags) -> Result<(vk::ShaderModule, vk::PipelineShaderStageCreateInfo<'a>)> {
    let module = gpu.create_shader_module(path)?;
    let stage_info = vk::PipelineShaderStageCreateInfo::default()
        .module(module)
        .name(SHADER_MAIN)
        .stage(flags);
    Ok((module, stage_info))
}

pub fn depth_attachment<'a>(
    image: &Image,
    load_op: vk::AttachmentLoadOp,
    store_op: vk::AttachmentStoreOp,
    clear_value: vk::ClearValue,
) -> vk::RenderingAttachmentInfo<'a> {
    vk::RenderingAttachmentInfo::default()
        .image_view(image.view)
        .image_layout(vk::ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL)
        .load_op(load_op)
        .store_op(store_op)
        .clear_value(clear_value)
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

pub fn ps_viewport_single_dynamic<'a>() -> vk::PipelineViewportStateCreateInfo<'a> {
    vk::PipelineViewportStateCreateInfo::default()
        .viewport_count(1)
        .scissor_count(1)
}

pub fn depth_stencil_enabled<'a>() -> vk::PipelineDepthStencilStateCreateInfo<'a> {
    vk::PipelineDepthStencilStateCreateInfo::default()
        .depth_test_enable(true)
        .depth_write_enable(true)
        .min_depth_bounds(0.)
        .max_depth_bounds(1.)
        .depth_compare_op(vk::CompareOp::LESS)
}

pub fn multisample_state_disabled<'a>() -> vk::PipelineMultisampleStateCreateInfo<'a> {
    vk::PipelineMultisampleStateCreateInfo::default()
        .rasterization_samples(vk::SampleCountFlags::TYPE_1)
}

pub fn dynamic_state_default<'a>() -> vk::PipelineDynamicStateCreateInfo<'a> {
    vk::PipelineDynamicStateCreateInfo::default().dynamic_states(&DYNAMIC_STATES)
}

pub fn input_state_triangle_list<'a>() -> vk::PipelineInputAssemblyStateCreateInfo<'a> {
    vk::PipelineInputAssemblyStateCreateInfo::default()
        .topology(vk::PrimitiveTopology::TRIANGLE_LIST)
}

pub fn viewport_state_default<'a>() -> vk::PipelineViewportStateCreateInfo<'a> {
    vk::PipelineViewportStateCreateInfo::default()
        .viewport_count(1)
        .scissor_count(1)
}

pub fn raster_state_polygons<'a>(
    cull_mode: vk::CullModeFlags,
) -> vk::PipelineRasterizationStateCreateInfo<'a> {
    vk::PipelineRasterizationStateCreateInfo::default()
        .polygon_mode(vk::PolygonMode::FILL)
        .cull_mode(cull_mode)
        .front_face(vk::FrontFace::COUNTER_CLOCKWISE)
        .line_width(1.0)
}
