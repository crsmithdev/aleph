use {
    crate::mesh::{GeoSurface, GpuMeshBuffers, MeshAsset, MeshData, Vertex},
    aleph_hal::{
        Buffer,
        BufferInfo,
        BufferUsageFlags,
        CommandBuffer,
        DeletionQueue,
        Frame,
        Gpu,
        Image,
        ImageInfo,
        MemoryLocation,
    },
    anyhow::Result,
    ash::vk::{self, DescriptorSetLayout},
    nalgebra::{self as na, Vector4},
    std::{fmt, sync::Arc},
};

struct RenderObject {
    index_count: u32,
    first_index: u32,
    index_buffer: Buffer,
    transform: na::Matrix4<f32>,
    vertex_buffer_address: vk::DeviceAddress,
    // material
}

struct MaterialPipeline {
    pipeline: vk::Pipeline,
    layout: vk::PipelineLayout,
}

struct MaterialInstance {
    pipeline: MaterialPipeline,
    material_set: vk::DescriptorSet,
    pass_type: MaterialPass,
}

enum MaterialPass {
    MainColor,
    Transparent,
    Other,
}
pub struct RenderContext {}
pub trait Renderable {
    fn draw(&self, transform: &na::Matrix4<f32>, ctx: &RenderContext);
}

struct GltfMetallicRoughness {
    opaque_pipeline: MaterialPipeline,
    transparent_pipeline: MaterialPipeline,
    // material_layout: vk::DescriptorSetLayout,
    // writer: DescriptorWriter,
}

impl GltfMetallicRoughness {
    fn build_pipelines(&self) -> Result<()> {
        fn create_mesh_pipeline(
            gpu: &Gpu,
        ) -> Result<(vk::Pipeline, vk::PipelineLayout, vk::DescriptorSetLayout)> {
            let fn_name = std::ffi::CString::new("main").unwrap();
            let vertex_shader = gpu.load_shader("shaders/mesh.vert.spv")?;
            let fragment_shader = gpu.load_shader("shaders/mesh.frag.spv")?;
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
            let push_constant_ranges = &[vk::PushConstantRange::default()
                .stage_flags(vk::ShaderStageFlags::VERTEX)
                .size(std::mem::size_of::<GPUDrawPushConstants>() as u32)];
            let vertex_state_info = vk::PipelineVertexInputStateCreateInfo::default();
            let input_state_info = vk::PipelineInputAssemblyStateCreateInfo::default()
                .topology(vk::PrimitiveTopology::TRIANGLE_LIST);
            let multisample_state_info = vk::PipelineMultisampleStateCreateInfo::default()
                .sample_shading_enable(false)
                .min_sample_shading(1.0)
                .rasterization_samples(vk::SampleCountFlags::TYPE_1);
            let color_blend_attachments = &[vk::PipelineColorBlendAttachmentState::default()
                .blend_enable(false)
                .color_write_mask(
                    vk::ColorComponentFlags::A
                        | vk::ColorComponentFlags::R
                        | vk::ColorComponentFlags::G
                        | vk::ColorComponentFlags::B,
                )];
            let color_blend_state = vk::PipelineColorBlendStateCreateInfo::default()
                .attachments(color_blend_attachments)
                .logic_op(vk::LogicOp::COPY);
            let raster_state_info = vk::PipelineRasterizationStateCreateInfo::default()
                .polygon_mode(vk::PolygonMode::FILL)
                .cull_mode(vk::CullModeFlags::NONE)
                .front_face(vk::FrontFace::CLOCKWISE)
                .line_width(1.0);
            // .depth_bias_enable(true)
            // .depth_bias_constant_factor(4.0)
            // .depth_bias_slope_factor(1.5);
            let depth_stencil_info = vk::PipelineDepthStencilStateCreateInfo::default()
                .depth_test_enable(true)
                .depth_write_enable(true)
                .depth_compare_op(vk::CompareOp::GREATER_OR_EQUAL)
                .depth_bounds_test_enable(false)
                .max_depth_bounds(1.0);

            let viewport_state_info = vk::PipelineViewportStateCreateInfo::default()
                .viewport_count(1)
                .scissor_count(1);
            let dynamic_state_info = vk::PipelineDynamicStateCreateInfo::default()
                .dynamic_states(&[vk::DynamicState::VIEWPORT, vk::DynamicState::SCISSOR]);

            let descriptor_bindings = &[vk::DescriptorSetLayoutBinding::default()
                .binding(0)
                .stage_flags(vk::ShaderStageFlags::FRAGMENT)
                .descriptor_type(vk::DescriptorType::COMBINED_IMAGE_SAMPLER)
                .descriptor_count(1)];
            let descriptor_layouts = &[gpu.create_descriptor_set_layout(
                descriptor_bindings,
                vk::DescriptorSetLayoutCreateFlags::default(),
            )?];

            let layout_info = vk::PipelineLayoutCreateInfo::default()
                .push_constant_ranges(push_constant_ranges)
                .set_layouts(descriptor_layouts);
            let pipeline_layout =
                unsafe { gpu.device().create_pipeline_layout(&layout_info, None) }?;
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
                .layout(pipeline_layout)
                .stages(shader_stages)
                .push_next(&mut pipeline_rendering_info)];
            let pipeline = unsafe {
                gpu.device()
                    .create_graphics_pipelines(vk::PipelineCache::null(), pipeline_info, None)
                    .map_err(|err| anyhow::anyhow!(err.1))
            }?[0];

            Ok((pipeline, pipeline_layout, descriptor_layouts[0]))
        }
        // let opaque_pipeline = self.build_pipeline(MaterialPass::MainColor)?;
        // let transparent_pipeline = self.build_pipeline(MaterialPass::Transparent)?;
        // self.opaque_pipeline = opaque_pipeline;
        // self.transparent_pipeline = transparent_pipeline;
        Ok(())
    }
}

struct MaterialConstants {
    color_factors: na::Vector4<f32>,
    metal_rough_factors: na::Vector4<f32>,
    extra: [na::Vector4<f32>; 14],
}

struct MaterialResources {
    color_image: Image,
    color_sampler: vk::Sampler,
    metal_rough_image: Image,
    metal_rough_sampler: vk::Sampler,
    data_buffer: Buffer,
    data_buffer_offset: u32,
}

pub struct Renderer {
    gpu: Gpu,
    frames: Vec<Frame>,
    rebuild_swapchain: bool,
    current_frame: usize,
    draw_image: Image,
    // draw_descriptor_layout: vk::DescriptorSetLayout,
    // mesh_descriptor_layout: vk::DescriptorSetLayout,
    depth_image: Image,
    gradient_pipeline: vk::Pipeline,
    gradient_pipeline_layout: vk::PipelineLayout,
    mesh_pipeline: vk::Pipeline,
    mesh_pipeline_layout: vk::PipelineLayout,
    mesh: MeshAsset,
    texture_image: Image,
    sampler: vk::Sampler,
    deletion_queues: Vec<DeletionQueue>,
}

impl fmt::Debug for Renderer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Renderer").finish_non_exhaustive()
    }
}

impl Renderer {
    pub fn new(window: Arc<winit::window::Window>) -> Result<Self> {
        let gpu = Gpu::new(window)?;
        let pool = gpu.create_command_pool()?;
        let mut cmd = pool.create_command_buffer()?;

        let frames = Self::init_frames(&gpu)?;

        // cmd.deletion_queue.flush();

        let (draw_image, draw_descriptor_layout) = Self::create_draw_image(&gpu)?;
        let depth_image = Self::create_depth_image(&gpu)?;

        let (gradient_pipeline_layout, gradient_pipeline) =
            Self::create_gradient_pipeline(&gpu, draw_descriptor_layout)?;

        let (mesh_pipeline, mesh_pipeline_layout, _) = Self::create_mesh_pipeline(&gpu)?;

        let mesh_data = &crate::mesh::load_meshes2("assets/basicmesh.glb".to_string())?[2];
        let mesh = Self::create_mesh_buffers(&gpu, &mut cmd, mesh_data)?;

        let texture_image = Self::create_texture_image(&gpu, &mut cmd)?;
        let sampler_info = vk::SamplerCreateInfo::default()
            .mag_filter(vk::Filter::NEAREST)
            .min_filter(vk::Filter::NEAREST);
        let sampler = unsafe { &gpu.device().create_sampler(&sampler_info, None)? };
        let deletion_queues = (0..gpu.swapchain().in_flight_frames())
            .map(|_| DeletionQueue::default())
            .collect();

        // let frame_deletion_queues = (0..gpu.swapchain().in_flight_frames())
        //     .map(|_| DeletionQueue::default())
        //     .collect();
        // let global_deletion_queue = DeletionQueue::default();

        Ok(Self {
            gpu,
            frames,
            current_frame: 0,
            rebuild_swapchain: false,
            depth_image,
            draw_image,
            // draw_descriptor_layout,
            gradient_pipeline,
            gradient_pipeline_layout,
            mesh,
            // mesh_descriptor_layout,
            mesh_pipeline,
            mesh_pipeline_layout,
            sampler: *sampler,
            texture_image,
            deletion_queues,
            // cmd,
            // frame_deletion_queues,
            // global_deletion_queue,
        })
    }

    fn init_frames(gpu: &Gpu) -> Result<Vec<Frame>> {
        (0..gpu.swapchain().in_flight_frames())
            .map(|_| {
                let pool = gpu.create_command_pool()?;
                let command_buffer = pool.create_command_buffer()?;

                Ok(Frame {
                    swapchain_semaphore: gpu.create_semaphore()?,
                    render_semaphore: gpu.create_semaphore()?,
                    fence: gpu.create_fence_signaled()?,
                    command_pool: pool,
                    command_buffer,
                    deletion_queue: DeletionQueue::default(),
                })
            })
            .collect()
    }

    pub fn rebuild_swapchain(&mut self) -> Result<()> {
        self.gpu.rebuild_swapchain()?;
        self.frames = Self::init_frames(&self.gpu)?;
        self.rebuild_swapchain = false;

        Ok(())
    }

    pub fn render(&mut self) -> Result<()> {
        if self.rebuild_swapchain {
            self.rebuild_swapchain()?;
            return Ok(());
        }
        // let gpu = &self.gpu;
        let swapchain = &self.gpu.swapchain();
        let frame = &self.frames[self.current_frame % self.frames.len()];
        let fence = frame.fence;
        let cmd = &frame.command_buffer;
        let render_semaphore = &frame.render_semaphore;
        let swapchain_semaphore = &frame.swapchain_semaphore;
        // {
        //     let frame_deletion_queue =
        //         &mut self.frame_deletion_queues[(self.gpu.swapchain().current_index()
        //             % self.gpu.swapchain().in_flight_frames())
        //             as usize];
        //     frame_deletion_queue.flush();
        // }

        self.gpu.wait_for_fence(fence)?;
        let (image_index, rebuild) = {
            let (image_index, rebuild) = swapchain.acquire_next_image(*swapchain_semaphore)?;
            (image_index as usize, rebuild)
        };

        self.rebuild_swapchain = rebuild;
        self.gpu.reset_fence(fence)?;
        self.deletion_queues[image_index].flush();
        cmd.reset()?;
        cmd.begin()?;

        let swapchain_extent = swapchain.info.extent;
        let swapchain_image = &swapchain.images()[image_index];

        let draw_extent = {
            let extent = self.draw_image.info.extent;
            vk::Extent3D {
                width: extent.width.min(swapchain_extent.width),
                height: extent.height.min(swapchain_extent.height),
                depth: 1,
            }
        };

        cmd.transition_image(
            &self.depth_image,
            vk::ImageLayout::UNDEFINED,
            vk::ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
        );

        cmd.transition_image(
            &self.draw_image,
            vk::ImageLayout::UNDEFINED,
            vk::ImageLayout::GENERAL,
        );
        self.draw_background(cmd)?;

        cmd.transition_image(
            &self.draw_image,
            vk::ImageLayout::GENERAL,
            vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
        );

        self.draw_geometry(cmd)?;

        cmd.transition_image(
            &self.draw_image,
            vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
            vk::ImageLayout::TRANSFER_SRC_OPTIMAL,
        );
        cmd.transition_image(
            swapchain_image,
            vk::ImageLayout::UNDEFINED,
            vk::ImageLayout::TRANSFER_DST_OPTIMAL,
        );
        cmd.copy_image(
            &self.draw_image,
            swapchain_image,
            draw_extent,
            swapchain_extent.into(),
        );
        cmd.transition_image(
            swapchain_image,
            vk::ImageLayout::TRANSFER_DST_OPTIMAL,
            vk::ImageLayout::PRESENT_SRC_KHR,
        );

        cmd.end()?;
        cmd.submit_queued(&frame.swapchain_semaphore, &frame.render_semaphore, fence)?;
        let rebuild = swapchain.present(&[*render_semaphore], &[image_index as u32])?;

        self.rebuild_swapchain |= rebuild;
        self.current_frame = self.current_frame.wrapping_add(1);

        Ok(())
    }

    fn create_draw_image(gpu: &Gpu) -> Result<(Image, DescriptorSetLayout)> {
        let extent = gpu.swapchain().info.extent;
        let image = gpu.create_image(ImageInfo {
            label: Some("draw image"),
            extent,
            format: vk::Format::R16G16B16A16_SFLOAT,
            usage: vk::ImageUsageFlags::COLOR_ATTACHMENT
                | vk::ImageUsageFlags::TRANSFER_DST
                | vk::ImageUsageFlags::TRANSFER_SRC
                | vk::ImageUsageFlags::STORAGE,
            aspect_flags: vk::ImageAspectFlags::COLOR,
        })?;
        let bindings = &[vk::DescriptorSetLayoutBinding::default()
            .binding(0)
            .stage_flags(vk::ShaderStageFlags::COMPUTE)
            .descriptor_type(vk::DescriptorType::STORAGE_IMAGE)
            .descriptor_count(1)];
        let layout = gpu.create_descriptor_set_layout(
            bindings,
            vk::DescriptorSetLayoutCreateFlags::PUSH_DESCRIPTOR_KHR,
        )?;

        Ok((image, layout))
    }

    fn create_depth_image(gpu: &Gpu) -> Result<Image> {
        gpu.create_image(ImageInfo {
            label: Some("depth image"),
            extent: gpu.swapchain().info.extent,
            format: vk::Format::D32_SFLOAT,
            usage: vk::ImageUsageFlags::DEPTH_STENCIL_ATTACHMENT,
            aspect_flags: vk::ImageAspectFlags::DEPTH,
        })
    }

    fn create_mesh_buffers(
        gpu: &Gpu,
        cmd: &mut CommandBuffer,
        data: &MeshData,
    ) -> Result<MeshAsset> {
        let index_buffer = gpu.create_buffer(BufferInfo {
            label: Some("index"),
            usage: BufferUsageFlags::INDEX_BUFFER | BufferUsageFlags::TRANSFER_DST,
            location: MemoryLocation::GpuOnly,
            size: data.indices.len() * std::mem::size_of::<f32>(),
        })?;
        cmd.upload_buffer(&index_buffer, &data.indices)?;

        let vertex_buffer = gpu.create_buffer(BufferInfo {
            label: Some("vertex"),
            usage: BufferUsageFlags::STORAGE_BUFFER
                | BufferUsageFlags::TRANSFER_DST
                | BufferUsageFlags::SHADER_DEVICE_ADDRESS,
            location: MemoryLocation::GpuOnly,
            size: data.vertices.len() * std::mem::size_of::<Vertex>(),
        })?;
        cmd.upload_buffer(&vertex_buffer, &data.vertices)?;

        let device_address = vertex_buffer.address();

        Ok(MeshAsset {
            name: "test".to_owned(),
            surfaces: vec![GeoSurface {
                start_index: 0,
                count: data.indices.len() as u32,
            }],
            mesh_buffers: GpuMeshBuffers {
                index_buffer,
                vertex_buffer,
                vertex_buffer_address: device_address,
            },
        })
    }
    fn create_texture_image(gpu: &Gpu, cmd: &mut CommandBuffer) -> Result<Image> {
        let black = Color::new(0.0, 0.0, 0.0, 0.0).packed();
        let magenta = Color::new(1.0, 0.0, 1.0, 1.0).packed();

        let pixels = {
            let mut pixels = vec![0u32; 16 * 16];
            for x in 0..16 {
                for y in 0..16 {
                    let offset = x + y * 16;
                    pixels[offset] = match (x + y) % 2 {
                        0 => black,
                        _ => magenta,
                    };
                }
            }
            pixels
        };
        let bytes: Vec<u8> = pixels.into_iter().flat_map(|i| i.to_le_bytes()).collect();

        let texture = gpu.create_image(ImageInfo {
            label: Some("texture"),
            extent: vk::Extent2D {
                width: 16,
                height: 16,
            },
            format: vk::Format::R8G8B8A8_UNORM,
            usage: vk::ImageUsageFlags::SAMPLED | vk::ImageUsageFlags::TRANSFER_DST,
            aspect_flags: vk::ImageAspectFlags::COLOR,
        })?;
        cmd.upload_image(gpu.allocator(), &texture, &bytes)?;
        Ok(texture)
    }

    fn create_mesh_pipeline(
        gpu: &Gpu,
    ) -> Result<(vk::Pipeline, vk::PipelineLayout, vk::DescriptorSetLayout)> {
        let fn_name = std::ffi::CString::new("main").unwrap();
        let vertex_shader = gpu.load_shader("shaders/colored_triangle_mesh.vert.spv")?;
        let fragment_shader = gpu.load_shader("shaders/tex_image.frag.spv")?;
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
            .blend_enable(false)
            .color_write_mask(
                vk::ColorComponentFlags::A
                    | vk::ColorComponentFlags::R
                    | vk::ColorComponentFlags::G
                    | vk::ColorComponentFlags::B,
            )];
        let color_blend_state =
            vk::PipelineColorBlendStateCreateInfo::default().attachments(color_blend_attachments);

        let descriptor_bindings = &[vk::DescriptorSetLayoutBinding::default()
            .binding(0)
            .stage_flags(vk::ShaderStageFlags::FRAGMENT)
            .descriptor_type(vk::DescriptorType::COMBINED_IMAGE_SAMPLER)
            .descriptor_count(1)];
        let descriptor_layouts = &[gpu.create_descriptor_set_layout(
            descriptor_bindings,
            vk::DescriptorSetLayoutCreateFlags::default(),
        )?];
        let push_constant_ranges = &[vk::PushConstantRange::default()
            .stage_flags(vk::ShaderStageFlags::VERTEX)
            .size(std::mem::size_of::<GPUDrawPushConstants>() as u32)];
        // let descriptor_layouts = &[descriptor_layout];
        let layout_info = vk::PipelineLayoutCreateInfo::default()
            .push_constant_ranges(push_constant_ranges)
            .set_layouts(descriptor_layouts);
        let pipeline_layout = unsafe { gpu.device().create_pipeline_layout(&layout_info, None) }?;
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
            .layout(pipeline_layout)
            .stages(shader_stages)
            .push_next(&mut pipeline_rendering_info)];
        let pipeline = unsafe {
            gpu.device()
                .create_graphics_pipelines(vk::PipelineCache::null(), pipeline_info, None)
                .map_err(|err| anyhow::anyhow!(err.1))
        }?[0];

        Ok((pipeline, pipeline_layout, descriptor_layouts[0]))
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

    fn draw_geometry(&self, cmd: &CommandBuffer) -> Result<()> {
        let draw_image = &self.draw_image;
        let depth_image = &self.depth_image;
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

        let image_info = &[vk::DescriptorImageInfo::default()
            .image_layout(vk::ImageLayout::SHADER_READ_ONLY_OPTIMAL)
            .image_view(self.texture_image.view)
            .sampler(self.sampler)];
        let image_write = vk::WriteDescriptorSet::default()
            .dst_binding(0)
            .descriptor_count(1)
            .descriptor_type(vk::DescriptorType::COMBINED_IMAGE_SAMPLER)
            .image_info(image_info);

        cmd.bind_pipeline(vk::PipelineBindPoint::COMPUTE, self.gradient_pipeline)?;

        cmd.push_descriptor_set(
            vk::PipelineBindPoint::GRAPHICS,
            self.mesh_pipeline_layout,
            image_write,
        );
        // let mesh = &self.test_mesh[2];
        let mesh = &self.mesh;
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
}

type Color = Vector4<f32>;

trait ColorExt {
    fn packed(&self) -> u32;
}

impl ColorExt for Color {
    fn packed(&self) -> u32 {
        let v2 = self.iter().map(|f| (f.clamp(0.0, 1.0) * 255.0) as u32);
        let v3 = Vector4::from_iterator(v2);
        u32::from_le_bytes([v3.x as u8, v3.y as u8, v3.z as u8, v3.w as u8])
    }
}

#[allow(dead_code)]
#[repr(C)]
#[derive(Clone, Copy, Debug, bytemuck::Pod, bytemuck::Zeroable, serde::Serialize)]
struct GPUDrawPushConstants {
    world_matrix: nalgebra::Matrix4<f32>, // glm::Mat4,
    vertex_buffer: vk::DeviceAddress,
}

// impl Drop for Renderer {
//     fn drop(&mut self) {
//         // self.mesh.mesh_buffers.vertex_buffer.destroy();
//         // self.mesh.mesh_buffers.index_buffer.destroy();
//         // self.draw_image.destroy();
//         // self.depth_image.destroy();
//         // self.texture_image.destroy();
//     }
// }
