use {
    crate::mesh::Vertex,
    aleph_hal::{
        vk::{
            buffer::{Buffer, BufferInfo, MemoryLocation},
            image::{Image, ImageInfo},
            CommandBuffer,
        },
        Context,
    },
    anyhow::Result,
    ash::vk::{self, Extent3D},
    nalgebra_glm as glm,
};

#[allow(dead_code)]
pub(crate) struct SceneRenderer {
    draw_image: Image,
    draw_image_layout: vk::DescriptorSetLayout,
    gradient_pipeline: vk::Pipeline,
    gradient_pipeline_layout: vk::PipelineLayout,
    mesh_pipeline: vk::Pipeline,
    mesh_pipeline_layout: vk::PipelineLayout,
    mesh_buffers: GpuMeshBuffers,
}

impl SceneRenderer {
    pub fn new(context: &Context, cmd: CommandBuffer) -> Result<Self> {
        let draw_image = Self::create_draw_image(context)?;
        let draw_image_layout = Self::create_descriptor_set_layout(context)?;
        let (gradient_pipeline_layout, gradient_pipeline) =
            Self::create_gradient_pipeline(context, draw_image_layout)?;
        let (mesh_pipeline_layout, mesh_pipeline) = Self::create_mesh_pipeline(context)?;
        let mesh_buffers = Self::create_default_data(context, &cmd)?;

        let imm_fence = context.create_fence_signaled()?;

        Ok(Self {
            draw_image,
            draw_image_layout,
            gradient_pipeline,
            gradient_pipeline_layout,
            mesh_pipeline,
            mesh_pipeline_layout,
            mesh_buffers,
        })
    }

    fn create_draw_image(context: &Context) -> Result<Image> {
        let extent = context.swapchain().info.extent;
        let draw_image = Image::new(&ImageInfo {
            allocator: context.allocator(),
            width: extent.width as usize,
            height: extent.height as usize,
            format: vk::Format::R16G16B16A16_SFLOAT,
            usage: vk::ImageUsageFlags::COLOR_ATTACHMENT
                | vk::ImageUsageFlags::TRANSFER_DST
                | vk::ImageUsageFlags::TRANSFER_SRC
                | vk::ImageUsageFlags::STORAGE,
        })?;
        Ok(draw_image)
    }

    fn create_descriptor_set_layout(context: &Context) -> Result<vk::DescriptorSetLayout> {
        let bindings = &[vk::DescriptorSetLayoutBinding::default()
            .binding(0)
            .stage_flags(vk::ShaderStageFlags::COMPUTE)
            .descriptor_type(vk::DescriptorType::STORAGE_IMAGE)
            .descriptor_count(1)];
        context.create_descriptor_set_layout(
            bindings,
            vk::DescriptorSetLayoutCreateFlags::PUSH_DESCRIPTOR_KHR,
        )
    }

    fn create_mesh_pipeline(context: &Context) -> Result<(vk::PipelineLayout, vk::Pipeline)> {
        let name = std::ffi::CString::new("main").unwrap();
        let vertex_shader = context.load_shader("shaders/colored_triangle.vert.spv")?;
        let vertex_shader_info = vk::PipelineShaderStageCreateInfo::default()
            .stage(vk::ShaderStageFlags::VERTEX)
            .name(name.as_c_str())
            .module(vertex_shader);

        let fragment_shader = context.load_shader("shaders/colored_triangle.frag.spv")?;
        let fragment_shader_info = vk::PipelineShaderStageCreateInfo::default()
            .stage(vk::ShaderStageFlags::FRAGMENT)
            .name(name.as_c_str())
            .module(fragment_shader);

        let range = vk::PushConstantRange::default()
            .stage_flags(vk::ShaderStageFlags::VERTEX)
            .offset(0)
            .size(std::mem::size_of::<GPUDrawPushConstants>() as u32);

        let v = vk::PipelineVertexInputStateCreateInfo::default();
        let i = vk::PipelineInputAssemblyStateCreateInfo::default()
            .topology(vk::PrimitiveTopology::TRIANGLE_LIST);
        let m = vk::PipelineMultisampleStateCreateInfo::default()
            .sample_shading_enable(false)
            .min_sample_shading(1.0)
            .rasterization_samples(vk::SampleCountFlags::TYPE_1);
        let r = vk::PipelineRasterizationStateCreateInfo::default()
            .polygon_mode(vk::PolygonMode::FILL)
            .cull_mode(vk::CullModeFlags::NONE)
            .front_face(vk::FrontFace::COUNTER_CLOCKWISE)
            .line_width(1.0);
        let d = vk::PipelineDepthStencilStateCreateInfo::default()
            .depth_test_enable(false)
            .depth_write_enable(false)
            .depth_compare_op(vk::CompareOp::NEVER)
            .max_depth_bounds(1.0);
        let vp = vk::PipelineViewportStateCreateInfo::default()
            .viewport_count(1)
            .scissor_count(1);
        let dy = vk::PipelineDynamicStateCreateInfo::default()
            .dynamic_states(&[vk::DynamicState::VIEWPORT, vk::DynamicState::SCISSOR]);

        let range = &[range];
        let layout_info = vk::PipelineLayoutCreateInfo::default().push_constant_ranges(range);
        let layout = unsafe { context.device().create_pipeline_layout(&layout_info, None) }?;

        let stages = &[fragment_shader_info, vertex_shader_info];
        let pipeline_info = &[vk::GraphicsPipelineCreateInfo::default()
            .vertex_input_state(&v)
            .input_assembly_state(&i)
            .multisample_state(&m)
            .rasterization_state(&r)
            .depth_stencil_state(&d)
            .viewport_state(&vp)
            .dynamic_state(&dy)
            .layout(layout)
            .stages(stages)];
        let pipeline = unsafe {
            context
                .device()
                .create_graphics_pipelines(vk::PipelineCache::null(), pipeline_info, None)
                .map_err(|err| anyhow::anyhow!(err.1))
        }?[0];

        Ok((layout, pipeline))
    }

    fn create_default_data(context: &Context, cmd: &CommandBuffer) -> Result<GpuMeshBuffers> {
        let vertices = vec![
            Vertex::default()
                .position(0.5, -0.5, 0.0)
                .color(0.0, 0.0, 0.0, 1.0),
            Vertex::default()
                .position(0.5, 0.5, 0.0)
                .color(0.5, 0.5, 0.5, 1.0),
            Vertex::default()
                .position(-0.5, -0.5, 0.0)
                .color(1.0, 0.0, 0.0, 1.0),
            Vertex::default()
                .position(-0.5, 0.5, 0.0)
                .color(0.0, 1.0, 0.0, 1.0),
        ];
        let vertex_buffer = context.create_buffer(BufferInfo {
            usage: vk::BufferUsageFlags::STORAGE_BUFFER
                | vk::BufferUsageFlags::TRANSFER_DST
                | vk::BufferUsageFlags::SHADER_DEVICE_ADDRESS,
            location: MemoryLocation::GpuOnly,
            size: vertices.len() * std::mem::size_of::<Vertex>(),
        })?;
        vertex_buffer.upload_data(cmd, &vertices)?;

        let indices = vec![0, 1, 2, 2, 1, 3];
        let index_buffer = context.create_buffer(BufferInfo {
            usage: vk::BufferUsageFlags::INDEX_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
            location: MemoryLocation::GpuOnly,
            size: vertices.len() * std::mem::size_of::<Vertex>(),
        })?;
        index_buffer.upload_data(cmd, &indices)?;

        let vertex_buffer_address = unsafe {
            context.device().get_buffer_device_address(
                &vk::BufferDeviceAddressInfo::default().buffer(vertex_buffer.handle()),
            )
        };

        Ok(GpuMeshBuffers {
            index_buffer,
            vertex_buffer,
            vertex_buffer_address,
        })
    }

    fn create_gradient_pipeline(
        context: &Context,
        descriptor_layout: vk::DescriptorSetLayout,
    ) -> Result<(vk::PipelineLayout, vk::Pipeline), anyhow::Error> {
        let shader = context.load_shader("shaders/gradient.spv")?;
        let descriptor_layout = [descriptor_layout];
        let pipeline_layout_info =
            vk::PipelineLayoutCreateInfo::default().set_layouts(&descriptor_layout);
        let gradient_pipeline_layout = unsafe {
            context
                .device()
                .create_pipeline_layout(&pipeline_layout_info, None)
        }?;
        let name = std::ffi::CString::new("main").unwrap();
        let stage_info = vk::PipelineShaderStageCreateInfo::default()
            .stage(vk::ShaderStageFlags::COMPUTE)
            .name(name.as_c_str())
            .module(shader);
        let pipeline_info = &[vk::ComputePipelineCreateInfo::default()
            .layout(gradient_pipeline_layout)
            .stage(stage_info)];
        let gradient_pipeline = unsafe {
            context
                .device()
                .create_compute_pipelines(vk::PipelineCache::null(), pipeline_info, None)
                .map_err(|err| anyhow::anyhow!(err.1))
        }?[0];
        Ok((gradient_pipeline_layout, gradient_pipeline))
    }

    pub fn render(&mut self, context: &Context, cmd: &CommandBuffer) -> Result<()> {
        let swapchain_extent = context.swapchain().info.extent;
        let swapchain_image = context.swapchain().current_image();
        let draw_image_extent = self.draw_image.extent;
        let draw_image = self.draw_image.inner;
        let draw_extent = Extent3D {
            width: draw_image_extent.width.min(swapchain_extent.width),
            height: draw_image_extent.height.min(swapchain_extent.height),
            depth: 1,
        };

        cmd.transition_image(
            draw_image,
            vk::ImageLayout::UNDEFINED,
            vk::ImageLayout::GENERAL,
        );

        self.draw_background(cmd)?;

        cmd.transition_image(
            draw_image,
            vk::ImageLayout::GENERAL,
            vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
        );

        self.draw_geometry(cmd, &self.draw_image)?;

        cmd.transition_image(
            draw_image,
            vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
            vk::ImageLayout::TRANSFER_SRC_OPTIMAL,
        );
        cmd.transition_image(
            swapchain_image,
            vk::ImageLayout::UNDEFINED,
            vk::ImageLayout::TRANSFER_DST_OPTIMAL,
        );
        cmd.copy_image(
            draw_image,
            swapchain_image,
            draw_extent,
            swapchain_extent.into(),
        );
        cmd.transition_image(
            swapchain_image,
            vk::ImageLayout::TRANSFER_DST_OPTIMAL,
            vk::ImageLayout::PRESENT_SRC_KHR,
        );

        Ok(())
    }

    fn draw_geometry(&self, cmd: &CommandBuffer, draw_image: &Image) -> Result<()> {
        let color_attachment = vk::RenderingAttachmentInfo::default()
            .image_view(draw_image.view)
            .image_layout(vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL);

        let extent = vk::Extent2D::default().width(draw_image.extent.width).height(draw_image.extent.height);

        cmd.begin_rendering2(&[color_attachment], extent)?;

        cmd.bind_pipeline(vk::PipelineBindPoint::GRAPHICS, self.mesh_pipeline)?;

        let viewport = vk::Viewport::default()
            .width(draw_image.extent.width as f32)
            .height(draw_image.extent.height as f32)
            .max_depth(1.0);
        cmd.set_viewport(viewport);
        
        let scissor = vk::Rect2D::default().extent(extent); 
        cmd.set_scissor(scissor);

        cmd.draw(3, 1, 0, 0);   
        cmd.end_rendering()
    }

    fn draw_background(&self, cmd: &CommandBuffer) -> Result<()> {
        let image_info = &[vk::DescriptorImageInfo::default()
            .image_layout(vk::ImageLayout::GENERAL)
            .image_view(self.draw_image.view)];
        let image_write = vk::WriteDescriptorSet::default()
            .dst_binding(0)
            .descriptor_count(1)
            .descriptor_type(vk::DescriptorType::STORAGE_IMAGE)
            .image_info(image_info);

        cmd.bind_pipeline(vk::PipelineBindPoint::COMPUTE, self.gradient_pipeline)?;

        cmd.push_descriptor_set(
            vk::PipelineBindPoint::COMPUTE,
            self.gradient_pipeline_layout,
            image_write,
        );
        cmd.dispatch(
            f32::ceil(self.draw_image.extent.width as f32 / 16.0) as u32,
            f32::ceil(self.draw_image.extent.height as f32 / 16.0) as u32,
            1,
        );

        Ok(())
    }

    pub fn destroy(&self, context: &Context) {
        unsafe {
            context
                .device()
                .destroy_pipeline(self.gradient_pipeline, None);
            context
                .device()
                .destroy_pipeline_layout(self.gradient_pipeline_layout, None);
            context
                .device()
                .destroy_descriptor_set_layout(self.draw_image_layout, None);
            // self.draw_image.destroy(context);
        }
    }
}

pub struct GpuMeshBuffers {
    pub index_buffer: Buffer,
    pub vertex_buffer: Buffer,
    pub vertex_buffer_address: vk::DeviceAddress,
}

struct GPUDrawPushConstants {
    world_matrix: glm::Mat4,
    vertex_buffer: vk::DeviceAddress,
}
