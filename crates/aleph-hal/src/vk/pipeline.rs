// use ash::vk;
// use crate::vk::Context;
// use anyhow::Result;

// struct Pipeline {
//     inner: vk::Pipeline,
// }

// impl Pipeline {
//     pub fn new(context: &Context) -> Result<Self> {
//         let viewport_info = vk::PipelineViewportStateCreateInfo::default()
//             .viewport_count(1)
//             .scissor_count(1);

//             let dynamic_info = vk::PipelineDynamicStateCreateInfo::default()
//             .dynamic_states(&[vk::DynamicState::VIEWPORT, vk::DynamicState::SCISSOR]);
//         let color_blend_attachment = [vk::PipelineColorBlendAttachmentState::default()];
//         let color_blend_info = vk::PipelineColorBlendStateCreateInfo::default()
//             .logic_op_enable(false)
//             .logic_op(vk::LogicOp::COPY)
//             .attachments(&color_blend_attachment);

//         let vertex_info = vk::PipelineVertexInputStateCreateInfo::default();

//             let shader = context.load_shader("shaders/triangle/colored_triangle.spv")?;
//             let shader_create_info = vk::PipelineShaderStageCreateInfo::default()
//                 .stage(vk::ShaderStageFlags::VERTEX)
//                 .module(shader)
//                 .name(std::ffi::CString::new("main").unwrap().as_c_str());

//         let pipeline = vk::GraphicsPipelineCreateInfo::default()
//             .viewport_state(&viewport_info)
//             .color_blend_state(&color_blend_info)
//             .vertex_input_state(&vertex_info)
//             .dynamic_state(&dynamic_info);



//         // VkPipelineViewportStateCreateInfo viewportState = {};
//         // viewportState.sType = VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO;
//         // viewportState.pNext = nullptr;

//         // viewportState.viewportCount = 1;
//         // viewportState.scissorCount = 1;

//         // // setup dummy color blending. We arent using transparent objects yet
//         // // the blending is just "no blend", but we do write to the color attachment
//         // VkPipelineColorBlendStateCreateInfo colorBlending = {};
//         // colorBlending.sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
//         // colorBlending.pNext = nullptr;

//         // colorBlending.logicOpEnable = VK_FALSE;
//         // colorBlending.logicOp = VK_LOGIC_OP_COPY;
//         // colorBlending.attachmentCount = 1;
//         // colorBlending.pAttachments = &_colorBlendAttachment;

//         // // completely clear VertexInputStateCreateInfo, as we have no need for it
//         // VkPipelineVertexInputStateCreateInfo _vertexInputInfo =

//         todo!();
//     }
// }
