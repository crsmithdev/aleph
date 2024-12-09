use {
    crate::ui::UiRenderer,
    aleph_hal::{
        vk::{
            descriptor::DescriptorAllocator,
            image::{Image, ImageInfo},
            CommandBuffer,
        },
        Context,
        Frame,
    },
    anyhow::Result,
    ash::vk::{self, Extent2D, Extent3D, GraphicsPipelineCreateInfo},
    nalgebra_glm as glm,
    std::{arch::x86_64::_CMP_NEQ_US, ffi, fmt, mem, process::Command, sync::Arc},
};

macro_rules! c_str {
    ($lit:expr) => {
        unsafe { ffi::CStr::from_ptr(concat!($lit, "\0").as_ptr() as *const core::ffi::c_char) }
    };
}

struct ComputePushConstants {
    data1: glm::Vec4,
    data2: glm::Vec4,
    data3: glm::Vec4,
    data4: glm::Vec4,
}

struct ComputeEffect {
    name: String,
    pipeline: vk::Pipeline,
    layout: vk::PipelineLayout,
    data: ComputePushConstants,
}

#[allow(dead_code)]
struct GraphicsRenderer {
    context: Context,
    descriptor_allocator: Arc<DescriptorAllocator>,
    draw_image: Image,
    depth_image: Image,
    draw_image_descriptors: vk::DescriptorSet,
    draw_image_layout: vk::DescriptorSetLayout,
    background_effect: ComputeEffect,
    triangle_pipeline: vk::Pipeline,
    // gradient_pipeline: vk::Pipeline,
    // gradient_pipeline_layout: vk::PipelineLayout,
}

impl GraphicsRenderer {
    pub fn new(context: &Context) -> Result<Self> {
        let extent = context.swapchain().extent();
        let draw_image = Image::new(&ImageInfo {
            allocator: context.allocator().clone(),
            width: extent.width as usize,
            height: extent.height as usize,
            format: vk::Format::R16G16B16A16_SFLOAT,
            aspects: vk::ImageAspectFlags::COLOR,
            usage: vk::ImageUsageFlags::COLOR_ATTACHMENT
                | vk::ImageUsageFlags::TRANSFER_DST
                | vk::ImageUsageFlags::TRANSFER_SRC
                | vk::ImageUsageFlags::STORAGE,
        })?;
        let depth_image = Image::new(&ImageInfo {
            allocator: context.allocator().clone(),
            width: extent.width as usize,
            height: extent.height as usize,
            format: vk::Format::D32_SFLOAT,
            aspects: vk::ImageAspectFlags::DEPTH,
            usage: vk::ImageUsageFlags::DEPTH_STENCIL_ATTACHMENT,
        })?;
        let descriptor_allocator = Arc::new(DescriptorAllocator::new(
            context.device(),
            &[vk::DescriptorPoolSize {
                ty: vk::DescriptorType::STORAGE_IMAGE,
                descriptor_count: 1,
            }],
            10,
        )?);
        log::info!("Created descriptor allocator: {:?}", &descriptor_allocator);

        let desc_bindings = &[vk::DescriptorSetLayoutBinding::default()
            .binding(0)
            .stage_flags(vk::ShaderStageFlags::COMPUTE)
            .descriptor_type(vk::DescriptorType::STORAGE_IMAGE)
            .descriptor_count(1)];
        let desc_layout = context.create_descriptor_set_layout(
            desc_bindings,
            vk::DescriptorSetLayoutCreateFlags::empty(),
        )?;

        let desc_sets = descriptor_allocator.allocate(&desc_layout)?;

        let image_info = &[vk::DescriptorImageInfo::default()
            .image_layout(vk::ImageLayout::GENERAL)
            .image_view(draw_image.view)];

        let image_write = &[vk::WriteDescriptorSet::default()
            .dst_binding(0)
            .dst_set(desc_sets)
            .descriptor_count(1)
            .descriptor_type(vk::DescriptorType::STORAGE_IMAGE)
            .image_info(image_info)];

        context.update_descriptor_sets(image_write, &[]);

        let background_effect = Self::init_background_pipelines(context, desc_layout)?;
        let triangle_pipeline = Self::init_triangle_pipeline(context)?;

        Ok(Self {
            context: context.clone(),
            descriptor_allocator,
            depth_image,
            draw_image,
            triangle_pipeline,
            draw_image_descriptors: desc_sets,
            draw_image_layout: desc_layout,
            background_effect,
        })
    }

    fn init_triangle_pipeline(context: &Context) -> Result<vk::Pipeline> {
        let frag_shader = context.load_shader("./shaders/triangle.frag.spv")?;
        let frag_module = vk::PipelineShaderStageCreateInfo::default()
            .stage(vk::ShaderStageFlags::FRAGMENT)
            .name(c_str!("main"))
            .module(frag_shader);
        let vertex_shader = context.load_shader("./shaders/triangle.vert.spv")?;
        let vertex_module = vk::PipelineShaderStageCreateInfo::default()
            .stage(vk::ShaderStageFlags::VERTEX)
            .name(c_str!("main"))
            .module(vertex_shader);
        let shader_info = &[vertex_module, frag_module];

        let viewport_state = vk::PipelineViewportStateCreateInfo::default()
            .viewport_count(1)
            .scissor_count(1);
        let input_state = vk::PipelineInputAssemblyStateCreateInfo::default()
            .topology(vk::PrimitiveTopology::TRIANGLE_LIST)
            .primitive_restart_enable(false);
        let raster_state = vk::PipelineRasterizationStateCreateInfo::default()
            .polygon_mode(vk::PolygonMode::FILL)
            .cull_mode(vk::CullModeFlags::BACK)
            .front_face(vk::FrontFace::CLOCKWISE)
            .line_width(1.0);
        let multisample_state = vk::PipelineMultisampleStateCreateInfo::default()
            .rasterization_samples(vk::SampleCountFlags::TYPE_1)
            .sample_shading_enable(false)
            .min_sample_shading(1.0);
        let color_blend_attachment = &[vk::PipelineColorBlendAttachmentState::default()
            .color_write_mask(vk::ColorComponentFlags::RGBA)
            .blend_enable(false)];
        let color_blend_state =
            vk::PipelineColorBlendStateCreateInfo::default().attachments(color_blend_attachment);

        let depth_stencil = vk::PipelineDepthStencilStateCreateInfo::default()
            .depth_test_enable(false)
            .depth_compare_op(vk::CompareOp::NEVER)
            .max_depth_bounds(1.0);
        let dynamic_info = vk::PipelineDynamicStateCreateInfo::default()
            .dynamic_states(&[vk::DynamicState::VIEWPORT, vk::DynamicState::SCISSOR]);
        let vertex_input_state = vk::PipelineVertexInputStateCreateInfo::default();
        let color_attachment_formats = &[vk::Format::R16G16B16A16_SFLOAT];
        let depth_attachment = vk::Format::D32_SFLOAT;
        let mut render_info = vk::PipelineRenderingCreateInfo::default()
            .color_attachment_formats(color_attachment_formats)
            .depth_attachment_format(depth_attachment);

        let layout_info = vk::PipelineLayoutCreateInfo::default();
        let layout = unsafe {
            context
                .device()
                .create_pipeline_layout(&layout_info, None)?
        };
        let pipeline_info = &[vk::GraphicsPipelineCreateInfo::default()
            .stages(shader_info)
            .layout(layout)
            .input_assembly_state(&input_state)
            .rasterization_state(&raster_state)
            .multisample_state(&multisample_state)
            .color_blend_state(&color_blend_state)
            .depth_stencil_state(&depth_stencil)
            .dynamic_state(&dynamic_info)
            .viewport_state(&viewport_state)
            .vertex_input_state(&vertex_input_state)
            .push_next(&mut render_info)
            .subpass(0)];

        Ok(unsafe {
            context
                .device
                .create_graphics_pipelines(vk::PipelineCache::null(), pipeline_info, None)
                .map_err(|err| anyhow::anyhow!(err.1))
        }?[0])
    }

    fn init_background_pipelines(
        context: &Context,
        layout: vk::DescriptorSetLayout,
    ) -> Result<ComputeEffect> {
        let working_dir = std::env::current_dir()?;
        dbg!(working_dir);
        let layouts = &[layout];
        let gradient_range = &[vk::PushConstantRange::default()
            .stage_flags(vk::ShaderStageFlags::COMPUTE)
            .size(mem::size_of::<ComputePushConstants>() as u32)];
        let gradient_layout_info = vk::PipelineLayoutCreateInfo::default()
            .set_layouts(layouts)
            .push_constant_ranges(gradient_range);
        let gradient_layout = unsafe {
            context
                .device()
                .create_pipeline_layout(&gradient_layout_info, None)
        }?;

        let gradient_shader_module = context.load_shader("./shaders/gradient.comp.spv")?;
        let gradient_shader = vk::PipelineShaderStageCreateInfo::default()
            .stage(vk::ShaderStageFlags::COMPUTE)
            .name(c_str!("main"))
            .module(gradient_shader_module);

        let gradient_pipeline_info = &[vk::ComputePipelineCreateInfo::default()
            .layout(gradient_layout)
            .stage(gradient_shader)];

        let gradient_pipeline = unsafe {
            context
                .device()
                .create_compute_pipelines(vk::PipelineCache::null(), gradient_pipeline_info, None)
                .map_err(|err| anyhow::anyhow!(err.1))
        }?[0];
        let gradient_effect = ComputeEffect {
            name: "gradient".to_string(),
            pipeline: gradient_pipeline,
            layout: gradient_layout,
            data: ComputePushConstants {
                data1: glm::vec4(1.0, 0.0, 0.0, 1.0),
                data2: glm::vec4(0.0, 0.0, 1.0, 1.0),
                data3: glm::vec4(0.0, 0.0, 0.0, 0.0),
                data4: glm::vec4(0.0, 0.0, 0.0, 0.0),
            },
        };

        unsafe {
            context
                .device()
                .destroy_shader_module(gradient_shader_module, None)
        };
        Ok(gradient_effect)
    }

    fn draw_geometry(&self, cmd: &CommandBuffer) -> Result<()> {
        let extent = Extent2D {
            width: self.draw_image.extent.width,
            height: self.draw_image.extent.height,
        };
        let color_attachment = [vk::RenderingAttachmentInfo::default()
            .image_view(self.draw_image.view)
            .image_layout(vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL)];
        let depth_attachment = vk::RenderingAttachmentInfo::default()
            .image_view(self.depth_image.view)
            .image_layout(vk::ImageLayout::DEPTH_ATTACHMENT_OPTIMAL);
        let render_area = vk::Rect2D::default().extent(extent);
        let render_info = vk::RenderingInfo::default()
            .render_area(render_area)
            .color_attachments(&color_attachment)
            .depth_attachment(&depth_attachment).layer_count(1);

        let viewport = [vk::Viewport::default()
            .x(0.0)
            .y(0.0)
            .width(extent.width as f32)
            .height(extent.height as f32)
            .min_depth(0.0)
            .max_depth(1.0)];
        let scissor = [vk::Rect2D::default()
            .extent(extent)
            .offset(vk::Offset2D::default())];

        unsafe {
            self.context.device.cmd_begin_rendering(**cmd, &render_info);
            self.context.device.cmd_bind_pipeline(
                **cmd,
                vk::PipelineBindPoint::GRAPHICS,
                self.triangle_pipeline,
            );
            self.context.device.cmd_set_viewport(**cmd, 0, &viewport);
            self.context.device.cmd_set_scissor(**cmd, 0, &scissor);
            self.context.device.cmd_draw(**cmd, 3, 1, 0, 0);
            self.context.device.cmd_end_rendering(**cmd);
        };

        Ok(())
        // VkRenderingAttachmentInfo colorAttachment = vkinit::attachment_info(_drawImage.imageView,
        // nullptr, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL); VkRenderingAttachmentInfo
        // depthAttachment = vkinit::depth_attachment_info(_depthImage.imageView,
        // VK_IMAGE_LAYOUT_DEPTH_ATTACHMENT_OPTIMAL); VkRenderingInfo renderInfo =
        // vkinit::rendering_info(_drawExtent, &colorAttachment, &depthAttachment);
        // vkCmdBeginRendering(cmd, &renderInfo);
        // vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, _trianglePipeline);
        // //set dynamic viewport and scissor
        // VkViewport viewport = {};
        // viewport.x = 0;
        // viewport.y = 0;
        // viewport.width = _drawExtent.width;
        // viewport.height = _drawExtent.height;
        // viewport.minDepth = 0.f;
        // viewport.maxDepth = 1.f;

        // vkCmdSetViewport(cmd, 0, 1, &viewport);

        // VkRect2D scissor = {};
        // scissor.offset.x = 0;
        // scissor.offset.y = 0;
        // scissor.extent.width = viewport.width;
        // scissor.extent.height = viewport.height;

        // vkCmdSetScissor(cmd, 0, 1, &scissor);
    }

    pub fn render(
        &mut self,
        command_buffer: &CommandBuffer,
        swapchain_image: &vk::Image,
    ) -> Result<()> {
        let context = &self.context;
        let swapchain_extent = context.swapchain().extent().into();
        let draw_image = self.draw_image.inner;
        let draw_extent: Extent3D = self.draw_image.extent;

        // vkutil::transition_image(cmd, _drawImage.image, VK_IMAGE_LAYOUT_UNDEFINED,
        // VK_IMAGE_LAYOUT_GENERAL);

        // draw_background(cmd);

        // vkutil::transition_image(cmd, _drawImage.image, VK_IMAGE_LAYOUT_GENERAL,
        // VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);

        // draw_geometry(cmd);

        // vkutil::transition_image(cmd, _drawImage.image, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,
        // VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL); vkutil::transition_image(cmd,
        // _swapchainImages[swapchainImageIndex], VK_IMAGE_LAYOUT_UNDEFINED,
        // VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL);

        // vkutil::copy_image_to_image(cmd, _drawImage.image,
        // _swapchainImages[swapchainImageIndex],_drawExtent ,_swapchainExtent); //< copyimage

        // 	// set swapchain image layout to Attachment Optimal so we can draw it
        // 	vkutil::transition_image(cmd, _swapchainImages[swapchainImageIndex],
        // VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);

        // 	//draw imgui into the swapchain image
        // 	draw_imgui(cmd, _swapchainImageViews[swapchainImageIndex]);

        // 	// set swapchain image layout to Present so we can draw it
        // 	vkutil::transition_image(cmd, _swapchainImages[swapchainImageIndex],
        // VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL, VK_IMAGE_LAYOUT_PRESENT_SRC_KHR);

        self.context.transition_image(
            command_buffer,
            draw_image,
            vk::ImageLayout::UNDEFINED,
            vk::ImageLayout::GENERAL,
        );

        self.draw_background(command_buffer);

        self.context.transition_image(
            command_buffer,
            draw_image,
            vk::ImageLayout::GENERAL,
            vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
        );

        self.draw_geometry(command_buffer)?;

        self.context.transition_image(
            command_buffer,
            draw_image,
            vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
            vk::ImageLayout::TRANSFER_SRC_OPTIMAL,
        );
        self.context.transition_image(
            command_buffer,
            *swapchain_image,
            vk::ImageLayout::UNDEFINED,
            vk::ImageLayout::TRANSFER_DST_OPTIMAL,
        );
        self.context.copy_image(
            command_buffer,
            draw_image,
            *swapchain_image,
            draw_extent,
            swapchain_extent,
        );
        self.context.transition_image(
            command_buffer,
            *swapchain_image,
            vk::ImageLayout::TRANSFER_DST_OPTIMAL,
            vk::ImageLayout::PRESENT_SRC_KHR,
        );

        Ok(())
    }

    fn draw_background(&self, cmd: &CommandBuffer) {
        let device = self.context.device();
        let descriptors = &[self.draw_image_descriptors];
        let effect = &self.background_effect;
        let extent = self.draw_image.extent;

        unsafe {
            device.cmd_bind_pipeline(cmd.inner, vk::PipelineBindPoint::COMPUTE, effect.pipeline);
            device.cmd_bind_descriptor_sets(
                cmd.inner,
                vk::PipelineBindPoint::COMPUTE,
                effect.layout,
                0,
                descriptors,
                &[],
            );
            let bytes = std::slice::from_raw_parts(
                &effect.data as *const ComputePushConstants as *const u8,
                size_of::<ComputePushConstants>(),
            );

            device.cmd_push_constants(
                cmd.inner,
                effect.layout,
                vk::ShaderStageFlags::COMPUTE,
                0,
                bytes,
            );

            let group_x = (extent.width as f32 / 16.0).ceil() as u32;
            let group_y = (extent.height as f32 / 16.0).ceil() as u32;
            let group_z = 1;
            device.cmd_dispatch(cmd.inner, group_x, group_y, group_z);
        }

        // unsafe {
        // device.cmd_bind_pipeline(
        //     cmd.inner,
        //     vk::PipelineBindPoint::COMPUTE,
        //     self.gradient_pipeline,
        // );

        // let extent = self.draw_image.extent;
        // let descriptors = &[self.draw_image_descriptors];
        // device.cmd_bind_descriptor_sets(
        //     cmd.inner,
        //     vk::PipelineBindPoint::COMPUTE,
        //     self.gradient_pipeline_layout,
        //     0,
        //     descriptors,
        //     &[],
        // );

        // device.cmd_dispatch(
        //     cmd.inner,
        //     f32::ceil(extent.width as f32 / 16.0) as u32,
        //     f32::ceil(extent.height as f32 / 16.0) as u32,
        //     1,
        // );
        // };
    }
}
#[allow(dead_code)]
pub struct Renderer {
    context: Context,
    frames: Vec<Frame>,
    graphics: GraphicsRenderer,
    ui: UiRenderer,
    rebuild_swapchain: bool,
    current_frame: usize,
}

impl fmt::Debug for Renderer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Renderer").finish_non_exhaustive()
    }
}

impl Renderer {
    pub fn new(context: Context) -> Result<Self> {
        let graphics = GraphicsRenderer::new(&context)?;
        let ui = UiRenderer::new(&context)?;
        let frames = Self::init_frames(context.clone())?;

        Ok(Self {
            context,
            frames,
            graphics,
            ui,
            current_frame: 0,
            rebuild_swapchain: false,
        })
    }

    pub fn ui_mut(&mut self) -> &mut UiRenderer {
        &mut self.ui
    }

    fn init_frames(context: Context) -> Result<Vec<Frame>> {
        (0..context.swapchain().image_views().len())
            .map(|_| {
                let command_pool = context.create_command_pool()?;
                let command_buffer = CommandBuffer::new(context.device(), command_pool)?;

                Ok(Frame {
                    swapchain_semaphore: context.create_semaphore()?,
                    render_semaphore: context.create_semaphore()?,
                    fence: context.create_fence_signaled()?,
                    command_pool,
                    command_buffer,
                })
            })
            .collect()
    }

    pub fn handle_event(&mut self, event: &winit::event::Event<()>) {
        self.ui.handle_event(event.clone());
    }

    pub fn render(&mut self) -> Result<()> {
        let context = &mut self.context;
        let frame = &self.frames[self.current_frame % self.frames.len()];
        if self.rebuild_swapchain {
            context.swapchain_mut().rebuild()?;
            self.rebuild_swapchain = false;
        }

        let fence = frame.fence;
        let command_buffer = &frame.command_buffer;
        let render_semaphore = &frame.render_semaphore;
        let swapchain_semaphore = &frame.swapchain_semaphore;

        context.wait_for_fence(fence)?;
        let (image_index, rebuild) = context.swapchain_mut().next_image(*swapchain_semaphore)?;
        let swapchain_image = context.swapchain().images()[image_index as usize];
        let swapchain_image_view = context.swapchain().image_views()[image_index as usize];
        self.rebuild_swapchain = rebuild;

        context.reset_fence(fence)?;
        command_buffer.reset()?;
        command_buffer.begin()?;

        self.graphics.render(command_buffer, &swapchain_image)?;
        self.ui.render(command_buffer, &swapchain_image_view)?;

        command_buffer.end()?;
        command_buffer.submit(swapchain_semaphore, render_semaphore, fence)?;

        self.rebuild_swapchain |= self
            .context
            .swapchain_mut()
            .present(&[*render_semaphore], &[image_index])?;

        self.current_frame = self.current_frame.wrapping_add(1);

        Ok(())
    }
}
