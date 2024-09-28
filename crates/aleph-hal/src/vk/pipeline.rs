use {
    crate::vk::{
        device::Device,
        render_pass::RenderPass,
        shader::ShaderDesc,
        swapchain::Swapchain,
        Vertex,
    },
    anyhow::Result,
    ash::{vk, vk::Handle},
    std::{ffi, fmt, mem::offset_of, sync::Arc},
};

pub struct Pipeline {
    pub inner: vk::Pipeline,
}

impl Pipeline {
    pub fn create(
        device: &Arc<Device>,
        swapchain: &Swapchain,
        render_pass: &RenderPass,
    ) -> Result<Pipeline> {
        let layout_create_info = vk::PipelineLayoutCreateInfo::default();

        let pipeline_layout = unsafe {
            device
                .inner
                .create_pipeline_layout(&layout_create_info, None)
                .unwrap()
        };

        let vertex_shader_module = device.load_shader(ShaderDesc {
            name: "vertex".to_owned(),
            path: "shaders/triangle/vert.spv".to_owned(),
        })?;
        let fragment_shader_module = device.load_shader(ShaderDesc {
            name: "fragment".to_owned(),
            path: "shaders/triangle/frag.spv".to_owned(),
        })?;

        let shader_entry_name = unsafe { ffi::CStr::from_bytes_with_nul_unchecked(b"main\0") };
        let shader_stage_create_infos = [
            vk::PipelineShaderStageCreateInfo {
                module: vertex_shader_module.inner,
                p_name: shader_entry_name.as_ptr(),
                stage: vk::ShaderStageFlags::VERTEX,
                ..Default::default()
            },
            vk::PipelineShaderStageCreateInfo {
                s_type: vk::StructureType::PIPELINE_SHADER_STAGE_CREATE_INFO,
                module: fragment_shader_module.inner,
                p_name: shader_entry_name.as_ptr(),
                stage: vk::ShaderStageFlags::FRAGMENT,
                ..Default::default()
            },
        ];
        let vertex_input_binding_descriptions = [vk::VertexInputBindingDescription {
            binding: 0,
            stride: size_of::<Vertex>() as u32,
            input_rate: vk::VertexInputRate::VERTEX,
        }];
        let vertex_input_attribute_descriptions = [
            vk::VertexInputAttributeDescription {
                location: 0,
                binding: 0,
                format: vk::Format::R32G32B32A32_SFLOAT,
                offset: offset_of!(Vertex, pos) as u32,
            },
            vk::VertexInputAttributeDescription {
                location: 1,
                binding: 0,
                format: vk::Format::R32G32B32A32_SFLOAT,
                offset: offset_of!(Vertex, color) as u32,
            },
        ];

        let vertex_input_state_info = vk::PipelineVertexInputStateCreateInfo::default()
            .vertex_attribute_descriptions(&vertex_input_attribute_descriptions)
            .vertex_binding_descriptions(&vertex_input_binding_descriptions);
        let vertex_input_assembly_state_info = vk::PipelineInputAssemblyStateCreateInfo {
            topology: vk::PrimitiveTopology::TRIANGLE_LIST,
            ..Default::default()
        };
        let viewports = [vk::Viewport {
            x: 0.0,
            y: 0.0,
            width: swapchain.desc.extent.width as f32,
            height: swapchain.desc.extent.height as f32,
            min_depth: 0.0,
            max_depth: 1.0,
        }];

        device.begin_command_buffer()?;
        let scissors = [swapchain.desc.extent.into()];
        let viewport_state_info = vk::PipelineViewportStateCreateInfo::default()
            .scissors(&scissors)
            .viewports(&viewports);

        let rasterization_info = vk::PipelineRasterizationStateCreateInfo {
            front_face: vk::FrontFace::COUNTER_CLOCKWISE,
            line_width: 1.0,
            polygon_mode: vk::PolygonMode::FILL,
            ..Default::default()
        };
        let multisample_state_info = vk::PipelineMultisampleStateCreateInfo {
            rasterization_samples: vk::SampleCountFlags::TYPE_1,
            ..Default::default()
        };
        let noop_stencil_state = vk::StencilOpState {
            fail_op: vk::StencilOp::KEEP,
            pass_op: vk::StencilOp::KEEP,
            depth_fail_op: vk::StencilOp::KEEP,
            compare_op: vk::CompareOp::ALWAYS,
            ..Default::default()
        };
        let depth_state_info = vk::PipelineDepthStencilStateCreateInfo {
            depth_test_enable: 1,
            depth_write_enable: 1,
            depth_compare_op: vk::CompareOp::LESS_OR_EQUAL,
            front: noop_stencil_state,
            back: noop_stencil_state,
            max_depth_bounds: 1.0,
            ..Default::default()
        };
        let color_blend_attachment_states = [vk::PipelineColorBlendAttachmentState {
            blend_enable: 0,
            src_color_blend_factor: vk::BlendFactor::SRC_COLOR,
            dst_color_blend_factor: vk::BlendFactor::ONE_MINUS_DST_COLOR,
            color_blend_op: vk::BlendOp::ADD,
            src_alpha_blend_factor: vk::BlendFactor::ZERO,
            dst_alpha_blend_factor: vk::BlendFactor::ZERO,
            alpha_blend_op: vk::BlendOp::ADD,
            color_write_mask: vk::ColorComponentFlags::RGBA,
        }];
        let color_blend_state = vk::PipelineColorBlendStateCreateInfo::default()
            .logic_op(vk::LogicOp::CLEAR)
            .attachments(&color_blend_attachment_states);

        let dynamic_state = [vk::DynamicState::VIEWPORT, vk::DynamicState::SCISSOR];
        let dynamic_state_info =
            vk::PipelineDynamicStateCreateInfo::default().dynamic_states(&dynamic_state);

        let graphic_pipeline_info = vk::GraphicsPipelineCreateInfo::default()
            .stages(&shader_stage_create_infos)
            .vertex_input_state(&vertex_input_state_info)
            .input_assembly_state(&vertex_input_assembly_state_info)
            .viewport_state(&viewport_state_info)
            .rasterization_state(&rasterization_info)
            .multisample_state(&multisample_state_info)
            .depth_stencil_state(&depth_state_info)
            .color_blend_state(&color_blend_state)
            .dynamic_state(&dynamic_state_info)
            .layout(pipeline_layout)
            .render_pass(render_pass.inner);
        let graphics_pipelines = unsafe {
            device
                .inner
                .create_graphics_pipelines(
                    vk::PipelineCache::null(),
                    &[graphic_pipeline_info],
                    None,
                )
                .expect("Unable to create graphics pipeline")
        };
        device.end_command_buffer(&[], &[], &[])?;
        Ok(Pipeline {
            inner: graphics_pipelines[0],
        })
    }
}

impl fmt::Debug for Pipeline {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Pipeline")
            .field("inner", &format_args!("{:x}", &self.inner.as_raw()))
            .finish_non_exhaustive()
    }
}
