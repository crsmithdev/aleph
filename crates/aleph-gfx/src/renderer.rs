use {
    aleph_hal::vk::{
        buffer::{Buffer, BufferDesc, BufferUsage, MemoryLocation},
        command_buffer::CommandBuffer,
        device::{Device, Fence, Semaphore, Texture},
        renderpass::RenderPass,
        shader::ShaderDesc,
        swapchain::Framebuffers,
        RenderBackend,
    },
    anyhow::Result,
    ash::vk::{self, Framebuffer, Rect2D},
    std::{ffi, sync::Arc},
};
#[derive(Clone, Debug, Copy)]
struct Vertex {
    pos: [f32; 4],
    color: [f32; 4],
}

#[macro_export]
macro_rules! offset_of {
    ($base:path, $field:ident) => {{
        #[allow(unused_unsafe)]
        unsafe {
            let b: $base = std::mem::zeroed();
            std::ptr::addr_of!(b.$field) as isize - std::ptr::addr_of!(b) as isize
        }
    }};
}

pub struct Renderer {
    backend: Arc<RenderBackend>,
    // pub present_images: Vec<vk::Image>,
    pub command_buffer: CommandBuffer,
    pub draw_command_buffer: CommandBuffer,
    pub draw_commands_reuse_fence: Fence,

    // pub depth_image: Texture,
    pub present_complete_semaphore: Semaphore,
    pub rendering_complete_semaphore: Semaphore,
    pub renderpass: RenderPass,
    pub framebuffers: Framebuffers,
    pub graphic_pipeline: vk::Pipeline,
    pub vertex_buffer: Buffer,
    pub index_buffer: Buffer,
    pub viewports: [vk::Viewport; 1],
    pub scissors: [Rect2D; 1],
    pub index_buffer_data: [u32; 3],
}

impl Renderer {
    pub fn new(backend: Arc<RenderBackend>) -> Result<Self> {
        let device = &backend.device.inner;
        let surface_resolution = backend.swapchain.properties.dims;

        unsafe {
            let draw_command_buffer = backend.device.create_command_buffer();
            let command_buffer = backend.device.create_command_buffer();

            let draw_commands_reuse_fence = backend.device.create_fence()?;
            let present_complete_semaphore = backend.device.create_semaphore()?;
            let rendering_complete_semaphore = backend.device.create_semaphore()?;
            let renderpass = backend.device.create_render_pass(&backend.swapchain)?; //, allocation_callbacks)

            let framebuffers = backend
                .device
                .create_framebuffers(&backend.swapchain, &renderpass)?;

            let index_buffer_data = [0u32, 1, 2];
            let index_buffer = backend.device.create_buffer(
                BufferDesc {
                    size: 3,
                    usage: BufferUsage::Index,
                    memory_location: MemoryLocation::CpuToGpu,
                },
                Some(&index_buffer_data),
            )?;

            let vertices = [
                Vertex {
                    pos: [-1.0, 1.0, 0.0, 1.0],
                    color: [0.0, 1.0, 0.0, 1.0],
                },
                Vertex {
                    pos: [1.0, 1.0, 0.0, 1.0],
                    color: [0.0, 0.0, 1.0, 1.0],
                },
                Vertex {
                    pos: [0.0, -1.0, 0.0, 1.0],
                    color: [1.0, 0.0, 0.0, 1.0],
                },
            ];
            let vertex_buffer = backend.device.create_buffer(
                BufferDesc {
                    size: 3,
                    usage: BufferUsage::Vertex,
                    memory_location: MemoryLocation::CpuToGpu,
                },
                Some(&vertices),
            )?;

            let vertex_shader_module = backend.device.load_shader(ShaderDesc {
                name: "vertex".to_owned(),
                path: "shaders/triangle/vert.spv".to_owned(),
            })?;
            let fragment_shader_module = backend.device.load_shader(ShaderDesc {
                name: "fragment".to_owned(),
                path: "shaders/triangle/frag.spv".to_owned(),
            })?;

            let layout_create_info = vk::PipelineLayoutCreateInfo::default();

            let pipeline_layout = device
                .create_pipeline_layout(&layout_create_info, None)
                .unwrap();

            let shader_entry_name = ffi::CStr::from_bytes_with_nul_unchecked(b"main\0");
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
                width: surface_resolution.width as f32,
                height: surface_resolution.height as f32,
                min_depth: 0.0,
                max_depth: 1.0,
            }];
            let scissors = [surface_resolution.into()];
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
                .render_pass(renderpass.inner);
            let graphics_pipelines = device
                .create_graphics_pipelines(
                    vk::PipelineCache::null(),
                    &[graphic_pipeline_info],
                    None,
                )
                .expect("Unable to create graphics pipeline");

            let graphic_pipeline = graphics_pipelines[0];
            Ok(Renderer {
                backend,
                renderpass,
                draw_command_buffer,
                framebuffers,
                draw_commands_reuse_fence,
                // present_images,
                // depth_image,
                present_complete_semaphore,
                rendering_complete_semaphore,
                graphic_pipeline,
                viewports,
                scissors,
                vertex_buffer,
                command_buffer,
                index_buffer,
                index_buffer_data,
            })
        }
    }

    pub fn update(&mut self) -> Result<()> {
        unsafe {
            let swapchain_loader = &self.backend.swapchain.fns;
            let swapchain = self.backend.swapchain.inner;
            let surface_resolution = self.backend.swapchain.properties.dims;
            let present_queue = self.backend.device.queue.inner;

            let (present_index, _) = swapchain_loader
                .acquire_next_image(
                    swapchain,
                    u64::MAX,
                    self.present_complete_semaphore.inner,
                    vk::Fence::null(),
                )
                .unwrap();
            let clear_values = [
                vk::ClearValue {
                    color: vk::ClearColorValue {
                        float32: [0.0, 0.0, 0.0, 0.0],
                    },
                },
                vk::ClearValue {
                    depth_stencil: vk::ClearDepthStencilValue {
                        depth: 1.0,
                        stencil: 0,
                    },
                },
            ];

            let render_pass_begin_info = vk::RenderPassBeginInfo::default()
                .render_pass(self.renderpass.inner)
                .framebuffer(self.framebuffers[present_index as usize])
                .render_area(surface_resolution.into())
                .clear_values(&clear_values);

            record_submit_commandbuffer(
                &self.backend.device,
                self.draw_command_buffer.inner,
                &self.draw_commands_reuse_fence,
                present_queue,
                &[vk::PipelineStageFlags::COLOR_ATTACHMENT_OUTPUT],
                &[self.present_complete_semaphore.inner],
                &[self.rendering_complete_semaphore.inner],
                |device, draw_command_buffer| {
                    let device = &device.inner;
                    device.cmd_begin_render_pass(
                        draw_command_buffer,
                        &render_pass_begin_info,
                        vk::SubpassContents::INLINE,
                    );
                    device.cmd_bind_pipeline(
                        draw_command_buffer,
                        vk::PipelineBindPoint::GRAPHICS,
                        self.graphic_pipeline,
                    );
                    device.cmd_set_viewport(draw_command_buffer, 0, &self.viewports);
                    device.cmd_set_scissor(draw_command_buffer, 0, &self.scissors);
                    device.cmd_bind_vertex_buffers(
                        draw_command_buffer,
                        0,
                        &[self.vertex_buffer.inner],
                        &[0],
                    );
                    device.cmd_bind_index_buffer(
                        draw_command_buffer,
                        self.index_buffer.inner,
                        0,
                        vk::IndexType::UINT32,
                    );
                    device.cmd_draw_indexed(
                        draw_command_buffer,
                        self.index_buffer_data.len() as u32,
                        1,
                        0,
                        0,
                        1,
                    );
                    device.cmd_end_render_pass(draw_command_buffer);
                },
            );
            let wait_semaphors = [self.rendering_complete_semaphore.inner];
            let swapchains = [swapchain];
            let image_indices = [present_index];
            let present_info = vk::PresentInfoKHR::default()
                .wait_semaphores(&wait_semaphors) // &rendering_complete_semaphore)
                .swapchains(&swapchains)
                .image_indices(&image_indices);

            swapchain_loader
                .queue_present(present_queue, &present_info)
                .unwrap();
        }
        Ok(())
    }
}

pub fn record_submit_commandbuffer<F: FnOnce(&Device, vk::CommandBuffer)>(
    device: &Arc<Device>,
    command_buffer: vk::CommandBuffer,
    command_buffer_reuse_fence: &Fence,
    submit_queue: vk::Queue,
    wait_mask: &[vk::PipelineStageFlags],
    wait_semaphores: &[vk::Semaphore],
    signal_semaphores: &[vk::Semaphore],
    f: F,
) {
    device.wait_for_fence(&command_buffer_reuse_fence).unwrap();
    unsafe {
        // device
        //     .wait_for_fences(&[command_buffer_reuse_fence], true, u64::MAX)
        //     .expect("Wait for fence failed.");

        // device
        //     .reset_fences(&[command_buffer_reuse_fence])
        //     .expect("Reset fences failed.");

        device
            .inner
            .reset_command_buffer(
                command_buffer,
                vk::CommandBufferResetFlags::RELEASE_RESOURCES,
            )
            .expect("Reset command buffer failed.");

        let command_buffer_begin_info = vk::CommandBufferBeginInfo::default()
            .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT);

        device
            .inner
            .begin_command_buffer(command_buffer, &command_buffer_begin_info)
            .expect("Begin commandbuffer");
        f(&device, command_buffer);
        device
            .inner
            .end_command_buffer(command_buffer)
            .expect("End commandbuffer");

        let command_buffers = vec![command_buffer];

        let submit_info = vk::SubmitInfo::default()
            .wait_semaphores(wait_semaphores)
            .wait_dst_stage_mask(wait_mask)
            .command_buffers(&command_buffers)
            .signal_semaphores(signal_semaphores);

        device
            .inner
            .queue_submit(
                submit_queue,
                &[submit_info],
                command_buffer_reuse_fence.inner,
            )
            .expect("queue submit failed.");
    }
}
