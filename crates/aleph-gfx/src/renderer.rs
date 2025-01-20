use {
    crate::mesh::{MeshAsset, Vertex},
    aleph_hal::{
        vk::{
            buffer::{Buffer, BufferInfo, MemoryLocation},
            image::{Image, ImageInfo},
            CommandBuffer,
        },
        Context,
    },
    anyhow::Result,
    ash::vk::{self, Extent3D, StencilOpState},
    nalgebra::{self as na, Isometry},
    nalgebra_glm::{self as glm, proj},
    std::sync::Arc,
};

#[allow(dead_code)]
pub(crate) struct SceneRenderer {
    draw_image: Image,
    draw_image_layout: vk::DescriptorSetLayout,
    depth_image: Image,
    gradient_pipeline: vk::Pipeline,
    gradient_pipeline_layout: vk::PipelineLayout,
    mesh_pipeline: vk::Pipeline,
    mesh_pipeline_layout: vk::PipelineLayout,
    test_meshes: Vec<MeshAsset>,
}

impl SceneRenderer {
    pub fn new(context: &Context, cmd: CommandBuffer) -> Result<Self> {
        let extent = context.swapchain().info.extent;
        let draw_image = Image::new(
            Arc::clone(context.allocator()),
            &ImageInfo {
                extent,
                format: vk::Format::R16G16B16A16_SFLOAT,
                usage: vk::ImageUsageFlags::COLOR_ATTACHMENT
                    | vk::ImageUsageFlags::TRANSFER_DST
                    | vk::ImageUsageFlags::TRANSFER_SRC
                    | vk::ImageUsageFlags::STORAGE,
                aspect_flags: vk::ImageAspectFlags::COLOR,
            },
        )?;
        let draw_image_layout = Self::create_descriptor_set_layout(context)?;

        let depth_image = Image::new(
            Arc::clone(context.allocator()),
            &ImageInfo {
                extent,
                format: vk::Format::D32_SFLOAT,
                usage: vk::ImageUsageFlags::DEPTH_STENCIL_ATTACHMENT,
                aspect_flags: vk::ImageAspectFlags::DEPTH,
            },
        )?;

        let (gradient_pipeline_layout, gradient_pipeline) =
            Self::create_gradient_pipeline(context, draw_image_layout)?;
        let (mesh_pipeline_layout, mesh_pipeline) = Self::create_mesh_pipeline(context)?;
        let test_meshes =
            crate::mesh::load_meshes("assets/basicmesh.glb".to_string(), context, &cmd)?;

        Ok(Self {
            draw_image,
            draw_image_layout,
            gradient_pipeline,
            gradient_pipeline_layout,
            mesh_pipeline,
            mesh_pipeline_layout,
            test_meshes,
            depth_image,
        })
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
        let vertex_shader = context.load_shader("shaders/colored_triangle_mesh.vert.spv")?;
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
            .line_width(1.0)
            .depth_bias_enable(true)
            .depth_bias_constant_factor(4.0)
            .depth_bias_slope_factor(1.5);
        let d = vk::PipelineDepthStencilStateCreateInfo::default()
            .depth_test_enable(true)
            .depth_write_enable(true)
            .depth_compare_op(vk::CompareOp::GREATER_OR_EQUAL)
            .depth_bounds_test_enable(false)
            .front(StencilOpState::default())
            .back(StencilOpState::default())
            .min_depth_bounds(0.0)
            .max_depth_bounds(1.0);
        let vp = vk::PipelineViewportStateCreateInfo::default()
            .viewport_count(1)
            .scissor_count(1);
        let dy = vk::PipelineDynamicStateCreateInfo::default()
            .dynamic_states(&[vk::DynamicState::VIEWPORT, vk::DynamicState::SCISSOR]);

        let range = &[range];
        let layout_info = vk::PipelineLayoutCreateInfo::default().push_constant_ranges(range);
        let layout = unsafe { context.device().create_pipeline_layout(&layout_info, None) }?;
        let mut pipeline_rendering_info = vk::PipelineRenderingCreateInfo::default()
            .color_attachment_formats(&[vk::Format::R16G16B16A16_SFLOAT])
            .depth_attachment_format(vk::Format::D32_SFLOAT);

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
            .stages(stages)
            .push_next(&mut pipeline_rendering_info)];
        let pipeline = unsafe {
            context
                .device()
                .create_graphics_pipelines(vk::PipelineCache::null(), pipeline_info, None)
                .map_err(|err| anyhow::anyhow!(err.1))
        }?[0];

        Ok((layout, pipeline))
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
        let draw_image_extent = self.draw_image.info.extent;
        let draw_image = self.draw_image.handle;
        let depth_image = self.depth_image.handle;
        let draw_extent = Extent3D {
            width: draw_image_extent.width.min(swapchain_extent.width),
            height: draw_image_extent.height.min(swapchain_extent.height),
            depth: 1,
        };

        cmd.transition_image(
            depth_image,
            vk::ImageLayout::UNDEFINED,
            vk::ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
        );

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

        self.draw_geometry(cmd, &self.draw_image, &self.depth_image)?;

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

    fn draw_geometry(
        &self,
        cmd: &CommandBuffer,
        draw_image: &Image,
        depth_image: &Image,
    ) -> Result<()> {
        let extent = self.draw_image.info.extent;
        let color_attachment = vk::RenderingAttachmentInfo::default()
            .image_view(draw_image.view)
            .image_layout(vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL);
        let depth_attachment = vk::RenderingAttachmentInfo::default()
            .image_view(depth_image.view)
            .image_layout(vk::ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL)
            .load_op(vk::AttachmentLoadOp::CLEAR)
            .store_op(vk::AttachmentStoreOp::STORE)
            .clear_value(vk::ClearValue {
                depth_stencil: vk::ClearDepthStencilValue {
                    depth: 0.0,
                    stencil: 0,
                },
            });

        cmd.begin_rendering2(&[color_attachment], &depth_attachment, extent)?;

        let viewport = vk::Viewport::default()
            .width(extent.width as f32)
            .height(0.0 - extent.height as f32)
            .x(0.)
            .y(extent.height as f32)
            .max_depth(1.0);
        cmd.set_viewport(viewport);

        let scissor = vk::Rect2D::default().extent(extent);
        cmd.set_scissor(scissor);

        cmd.bind_pipeline(vk::PipelineBindPoint::GRAPHICS, self.mesh_pipeline)?;
        let mesh = &self.test_meshes[2];
        let vertex_buffer = mesh.mesh_buffers.vertex_buffer_address;

        let model = na::Isometry3::new(na::Vector3::z(), na::zero());
        let eye = na::Point3::new(-1.0f32, -1.0f32, -1.0f32);
        let target = na::Point3::new(0.0, 0.0, 0.0);
        let view = na::Isometry3::look_at_rh(&eye, &target, &na::Vector3::y());
        let projection = na::Perspective3::new(
            extent.width as f32 / extent.height as f32,
            std::f32::consts::PI / 2.0,
            0.1,
            1000.0,
        );
        let world_matrix = projection.as_matrix() * (view * model).to_homogeneous();
        let constants = GPUDrawPushConstants {
            world_matrix,
            vertex_buffer,
        };

        cmd.push_constants(self.mesh_pipeline_layout, &constants);
        cmd.bind_index_buffer(
            mesh.mesh_buffers.index_buffer.handle(),
            0,
            vk::IndexType::UINT32,
        );
        cmd.draw_indexed(
            mesh.surfaces[0].count,
            1,
            mesh.surfaces[0].start_index,
            0,
            0,
        );

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
            f32::ceil(self.draw_image.info.extent.width as f32 / 16.0) as u32,
            f32::ceil(self.draw_image.info.extent.height as f32 / 16.0) as u32,
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
    world_matrix: nalgebra::Matrix4<f32>, // glm::Mat4,
    vertex_buffer: vk::DeviceAddress,
}
