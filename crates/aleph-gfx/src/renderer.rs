use {
    crate::mesh::{GeoSurface, GpuMeshBuffers, MeshAsset, Vertex},
    aleph_hal::{
        vk::deletion::Destroyable, BufferInfo, BufferUsageFlags, CommandBuffer, Gpu, Image, ImageInfo, MemoryLocation
    },
    anyhow::Result,
    ash::vk,
    nalgebra as na,
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
    test_mesh: MeshAsset,
}

impl Drop for SceneRenderer {
    fn drop(&mut self) {
        self.test_mesh.mesh_buffers.vertex_buffer.destroy();
        self.test_mesh.mesh_buffers.index_buffer.destroy();
        self.draw_image.destroy();
        self.depth_image.destroy();
    }
}

impl SceneRenderer {
    pub fn new(gpu: &Gpu, cmd: &mut CommandBuffer) -> Result<Self> {
        let extent = gpu.swapchain().info.extent;
        let draw_image = Image::new(
            Arc::clone(gpu.allocator()),
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
        let draw_image_layout = Self::create_descriptor_set_layout(gpu)?;

        let depth_image = Image::new(
            Arc::clone(gpu.allocator()),
            &ImageInfo {
                extent,
                format: vk::Format::D32_SFLOAT,
                usage: vk::ImageUsageFlags::DEPTH_STENCIL_ATTACHMENT,
                aspect_flags: vk::ImageAspectFlags::DEPTH,
            },
        )?;

        let (gradient_pipeline_layout, gradient_pipeline) =
            Self::create_gradient_pipeline(gpu, draw_image_layout)?;
        let (mesh_pipeline_layout, mesh_pipeline) = Self::create_mesh_pipeline(gpu)?;

        let mesh_data = &crate::mesh::load_meshes2("assets/basicmesh.glb".to_string())?[2];
        let index_buffer = gpu.create_buffer(BufferInfo {
            label: Some("index"),
            usage: BufferUsageFlags::INDEX_BUFFER | BufferUsageFlags::TRANSFER_DST,
            location: MemoryLocation::GpuOnly,
            size: mesh_data.indices.len() * std::mem::size_of::<f32>(),
        })?;
        cmd.upload_buffer(&index_buffer, &mesh_data.indices)?;

        let vertex_buffer = gpu.create_buffer(BufferInfo {
            label: Some("vertex"),
            usage: BufferUsageFlags::STORAGE_BUFFER
                | BufferUsageFlags::TRANSFER_DST
                | BufferUsageFlags::SHADER_DEVICE_ADDRESS,
            location: MemoryLocation::GpuOnly,
            size: mesh_data.vertices.len() * std::mem::size_of::<Vertex>(),
        })?;
        cmd.upload_buffer(&vertex_buffer, &mesh_data.vertices)?;
        
        let device_address = vertex_buffer.device_address();
        let test_mesh = MeshAsset {
            name: "test".to_owned(),
            surfaces: vec![GeoSurface {
                start_index: 0,
                count: mesh_data.indices.len() as u32,
            }],
            mesh_buffers: GpuMeshBuffers {
                index_buffer,
                vertex_buffer,
                vertex_buffer_address: device_address,
            },
        };

        Ok(Self {
            draw_image,
            draw_image_layout,
            gradient_pipeline,
            gradient_pipeline_layout,
            mesh_pipeline,
            mesh_pipeline_layout,
            test_mesh,
            depth_image,
        })
    }

    fn create_descriptor_set_layout(gpu: &Gpu) -> Result<vk::DescriptorSetLayout> {
        let bindings = &[vk::DescriptorSetLayoutBinding::default()
            .binding(0)
            .stage_flags(vk::ShaderStageFlags::COMPUTE)
            .descriptor_type(vk::DescriptorType::STORAGE_IMAGE)
            .descriptor_count(1)];
        gpu.create_descriptor_set_layout(
            bindings,
            vk::DescriptorSetLayoutCreateFlags::PUSH_DESCRIPTOR_KHR,
        )
    }

    fn create_mesh_pipeline(gpu: &Gpu) -> Result<(vk::PipelineLayout, vk::Pipeline)> {
        let fn_name = std::ffi::CString::new("main").unwrap();
        let vertex_shader = gpu.load_shader("shaders/colored_triangle_mesh.vert.spv")?;
        let fragment_shader = gpu.load_shader("shaders/colored_triangle.frag.spv")?;
        let shader_stages = &[
            vk::PipelineShaderStageCreateInfo::default()
                .stage(vk::ShaderStageFlags::VERTEX)
                .name(fn_name.as_c_str())
                .module(vertex_shader),
            vk::PipelineShaderStageCreateInfo::default()
                .stage(vk::ShaderStageFlags::FRAGMENT)
                .name(fn_name.as_c_str())
                .module(fragment_shader),
        ];

        let vertex_state_info = vk::PipelineVertexInputStateCreateInfo::default();
        let input_state_info = vk::PipelineInputAssemblyStateCreateInfo::default()
            .topology(vk::PrimitiveTopology::TRIANGLE_LIST);
        let multisample_state_info = vk::PipelineMultisampleStateCreateInfo::default()
            .sample_shading_enable(false)
            .min_sample_shading(1.0)
            .rasterization_samples(vk::SampleCountFlags::TYPE_1);
        let raster_state_info = vk::PipelineRasterizationStateCreateInfo::default()
            .polygon_mode(vk::PolygonMode::FILL)
            .cull_mode(vk::CullModeFlags::NONE)
            .front_face(vk::FrontFace::COUNTER_CLOCKWISE)
            .line_width(1.0)
            .depth_bias_enable(true)
            .depth_bias_constant_factor(4.0)
            .depth_bias_slope_factor(1.5);
        let depth_stencil_info = vk::PipelineDepthStencilStateCreateInfo::default()
            .depth_test_enable(true)
            .depth_write_enable(true)
            .depth_compare_op(vk::CompareOp::GREATER_OR_EQUAL)
            .depth_bounds_test_enable(false)
            .min_depth_bounds(0.0)
            .max_depth_bounds(1.0);
        let viewport_state_info = vk::PipelineViewportStateCreateInfo::default()
            .viewport_count(1)
            .scissor_count(1);
        let dynamic_state_info = vk::PipelineDynamicStateCreateInfo::default()
            .dynamic_states(&[vk::DynamicState::VIEWPORT, vk::DynamicState::SCISSOR]);
        let color_blend_attachments = &[vk::PipelineColorBlendAttachmentState::default()
            .blend_enable(true)
            .src_color_blend_factor(vk::BlendFactor::SRC_ALPHA)
            .dst_color_blend_factor(vk::BlendFactor::ONE)
            .src_alpha_blend_factor(vk::BlendFactor::ONE)
            .dst_alpha_blend_factor(vk::BlendFactor::ZERO)
            .color_blend_op(vk::BlendOp::ADD)
            .color_write_mask(
                vk::ColorComponentFlags::A
                    | vk::ColorComponentFlags::R
                    | vk::ColorComponentFlags::G
                    | vk::ColorComponentFlags::B,
            )];
        let color_blend_state =
            vk::PipelineColorBlendStateCreateInfo::default().attachments(color_blend_attachments);

        let push_constant_ranges = &[vk::PushConstantRange::default()
            .stage_flags(vk::ShaderStageFlags::VERTEX)
            .size(std::mem::size_of::<GPUDrawPushConstants>() as u32)];
        let layout_info =
            vk::PipelineLayoutCreateInfo::default().push_constant_ranges(push_constant_ranges);
        let layout = unsafe { gpu.device().create_pipeline_layout(&layout_info, None) }?;
        let mut pipeline_rendering_info = vk::PipelineRenderingCreateInfo::default()
            .color_attachment_formats(&[vk::Format::R16G16B16A16_SFLOAT])
            .depth_attachment_format(vk::Format::D32_SFLOAT);

        let pipeline_info = &[vk::GraphicsPipelineCreateInfo::default()
            .color_blend_state(&color_blend_state)
            .vertex_input_state(&vertex_state_info)
            .input_assembly_state(&input_state_info)
            .multisample_state(&multisample_state_info)
            .rasterization_state(&raster_state_info)
            .depth_stencil_state(&depth_stencil_info)
            .viewport_state(&viewport_state_info)
            .dynamic_state(&dynamic_state_info)
            .layout(layout)
            .stages(shader_stages)
            .push_next(&mut pipeline_rendering_info)];
        let pipeline = unsafe {
            gpu.device()
                .create_graphics_pipelines(vk::PipelineCache::null(), pipeline_info, None)
                .map_err(|err| anyhow::anyhow!(err.1))
        }?[0];

        Ok((layout, pipeline))
    }

    fn create_gradient_pipeline(
        gpu: &Gpu,
        descriptor_layout: vk::DescriptorSetLayout,
    ) -> Result<(vk::PipelineLayout, vk::Pipeline), anyhow::Error> {
        let shader = gpu.load_shader("shaders/gradient.spv")?;
        let descriptor_layout = [descriptor_layout];
        let pipeline_layout_info =
            vk::PipelineLayoutCreateInfo::default().set_layouts(&descriptor_layout);
        let gradient_pipeline_layout = unsafe {
            gpu.device()
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
            gpu.device()
                .create_compute_pipelines(vk::PipelineCache::null(), pipeline_info, None)
                .map_err(|err| anyhow::anyhow!(err.1))
        }?[0];
        Ok((gradient_pipeline_layout, gradient_pipeline))
    }

    pub fn render(&mut self, gpu: &Gpu, cmd: &CommandBuffer) -> Result<()> {
        let swapchain_extent = gpu.swapchain().info.extent;
        let swapchain_image = gpu.swapchain().current_image();
        let draw_image_extent = self.draw_image.info.extent;
        let draw_image = self.draw_image.handle;
        let depth_image = self.depth_image.handle;
        let draw_extent = vk::Extent3D {
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

        cmd.begin_rendering(&[color_attachment], Some(&depth_attachment), extent)?;

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
        // let mesh = &self.test_mesh[2];
        let mesh = &self.test_mesh;
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

    // pub fn destroy(&self, gpu: &Gpu) {
    //     unsafe {
    //         gpu.device().destroy_pipeline(self.gradient_pipeline, None);
    //         gpu.device()
    //             .destroy_pipeline_layout(self.gradient_pipeline_layout, None);
    //         gpu.device()
    //             .destroy_descriptor_set_layout(self.draw_image_layout, None);
    //         // self.draw_image.destroy(gpu);
    //     }
    // }
}

// pub struct GpuMeshBuffers {
//     pub index_buffer: Buffer,
//     pub vertex_buffer: Buffer,
//     pub vertex_buffer_address: vk::DeviceAddress,
// }

#[allow(dead_code)]
#[repr(C)]
#[derive(Clone, Copy, Debug, bytemuck::Pod, bytemuck::Zeroable, serde::Serialize)]
struct GPUDrawPushConstants {
    world_matrix: nalgebra::Matrix4<f32>, // glm::Mat4,
    vertex_buffer: vk::DeviceAddress,
}

// impl Copy for GPUDrawPushConstants {
//     fn copy(&self) -> Self {
//         *self
//     }
// }
