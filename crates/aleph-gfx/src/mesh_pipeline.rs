use {
    crate::{
        graph::{GpuGlobalData, GpuModelData, Pipeline, RenderContext, RenderObject},
        mesh::Vertex,
        util::{self, ShaderStageFlags},
        vk::{
            AttachmentLoadOp,
            AttachmentStoreOp,
            ClearDepthStencilValue,
            ClearValue,
            ColorComponentFlags,
            CullModeFlags,
            DescriptorBufferInfo,
            DescriptorSetLayout,
            DescriptorSetLayoutCreateFlags,
            DescriptorType,
            Device,
            Format,
            FrontFace,
            Gpu,
            GraphicsPipelineCreateInfo,
            Image,
            ImageLayout,
            Pipeline as VkPipeline,
            PipelineBindPoint,
            PipelineColorBlendAttachmentState,
            PipelineLayout,
            PipelineRenderingCreateInfo,
            PipelineVertexInputStateCreateInfo,
            Rect2D,
            RenderingAttachmentInfo,
            VertexInputAttributeDescription,
            VertexInputBindingDescription,
            Viewport,
            WriteDescriptorSet,
        },
    },
    anyhow::Result,
    glam::Vec3,
};

const BINDING_INDEX_GLOBAL_UBO: u32 = 0;
const BINDING_INDEX_MODEL_UBO: u32 = 1;

pub struct MeshPipeline {
    handle: VkPipeline,
    layout: PipelineLayout,
    // descriptor_layout: DescriptorSetLayout,
    // texture_image: Image,
    // texture_sampler: Sampler,
}

impl Pipeline for MeshPipeline {
    fn execute(&self, context: &RenderContext) -> Result<()> {
        let cmd = context.command_buffer;
        let color_attachments = &[RenderingAttachmentInfo::default()
            .image_view(context.draw_image.view)
            .image_layout(ImageLayout::COLOR_ATTACHMENT_OPTIMAL)];
        let clear_value = ClearValue {
            depth_stencil: ClearDepthStencilValue {
                depth: 1.0,
                stencil: 0,
            },
        };
        let depth_attachment = &util::depth_attachment(
            context.depth_image,
            AttachmentLoadOp::CLEAR,
            AttachmentStoreOp::STORE,
            clear_value,
        );

        let extent = context.extent;
        cmd.begin_rendering(
            color_attachments,
            Some(depth_attachment),
            context.extent,
        )?;
        let viewport = Viewport::default()
            .width(extent.width as f32)
            .height(0.0 - extent.height as f32)
            .x(0.)
            .y(extent.height as f32)
            .max_depth(1.0);
        cmd.set_viewport(viewport);

        let scissor = Rect2D::default().extent(extent);
        cmd.set_scissor(scissor);

        cmd.bind_pipeline(PipelineBindPoint::GRAPHICS, self.handle)?;
        for object in context.objects {
            self.bind_object_descriptors(object, context);
            object.bind_mesh_buffers(cmd);
            object.draw(cmd);
        }
        cmd.end_rendering()?;
        Ok(())
    }
}

impl MeshPipeline {
    pub fn new(gpu: &Gpu, texture_image: Image) -> Result<Self> {
        let device = gpu.device();
        let descriptor_layout = Self::create_descriptor_layout(device)?;
        let pipeline_layout = device.create_pipeline_layout(&[descriptor_layout], &[])?;
        let pipeline = Self::create_pipeline(device, pipeline_layout)?;
        // let sampler_info = SamplerCreateInfo::default()
        //     .mag_filter(Filter::LINEAR)
        //     .min_filter(Filter::LINEAR);
        // let texture_sampler = unsafe { gpu.device().create_sampler(&sampler_info, None)? };

        Ok(Self {
            handle: pipeline,
            layout: pipeline_layout,
            // descriptor_layout,
            // texture_image,
            // texture_sampler,
        })
    }

    fn create_descriptor_layout(device: &Device) -> Result<DescriptorSetLayout> {
        let bindings = &[
            util::buffer_binding(BINDING_INDEX_GLOBAL_UBO, ShaderStageFlags::VERTEX),
            util::buffer_binding(BINDING_INDEX_MODEL_UBO, ShaderStageFlags::VERTEX),
        ];

        device.create_descriptor_set_layout(
            bindings,
            DescriptorSetLayoutCreateFlags::PUSH_DESCRIPTOR_KHR,
        )
    }

    fn bind_object_descriptors(&self, object: &RenderObject, context: &RenderContext) {
        let global_info = &[DescriptorBufferInfo::default()
            .buffer(context.global_buffer.handle())
            .offset(0)
            .range(std::mem::size_of::<GpuGlobalData>() as u64)];
        let model_info = &[DescriptorBufferInfo::default()
            .buffer(object.model_buffer.handle())
            .offset(0)
            .range(std::mem::size_of::<GpuModelData>() as u64)];
        let writes = &[
            WriteDescriptorSet::default()
                .dst_binding(BINDING_INDEX_GLOBAL_UBO)
                .descriptor_count(1)
                .descriptor_type(DescriptorType::UNIFORM_BUFFER)
                .buffer_info(global_info),
            WriteDescriptorSet::default()
                .dst_binding(BINDING_INDEX_MODEL_UBO)
                .descriptor_count(1)
                .descriptor_type(DescriptorType::UNIFORM_BUFFER)
                .buffer_info(model_info),
        ];
        context.command_buffer.push_descriptor_sets(
            PipelineBindPoint::GRAPHICS,
            self.layout,
            writes,
        );
    }

    fn create_pipeline(device: &Device, layout: PipelineLayout) -> Result<VkPipeline> {
        let (_vs_module, vs_stage) =
            util::load_shader("shaders/mesh.vert.spv", device, ShaderStageFlags::VERTEX)?;
        let (_fs_module, fs_stage) =
            util::load_shader("shaders/mesh.frag.spv", device, ShaderStageFlags::FRAGMENT)?;
        let stages = &[vs_stage, fs_stage];
        let dynamic_state = util::dynamic_state_default();
        let input_state = util::input_state_triangle_list();
        let raster_state = util::raster_state_polygons(CullModeFlags::BACK);
        let multisample_state = util::multisample_state_disabled();
        let viewport_state = util::viewport_state_default();
        let depth_stencil_state = util::depth_stencil_enabled();
        let attachments = &[PipelineColorBlendAttachmentState::default()
            .blend_enable(false)
            .color_write_mask(
                ColorComponentFlags::A
                    | ColorComponentFlags::R
                    | ColorComponentFlags::G
                    | ColorComponentFlags::B,
            )];
        let color_blend_state = util::color_blend_disabled(attachments);
        let vec3_size = std::mem::size_of::<Vec3>() as u32;
        let uv_size = std::mem::size_of::<f32>() as u32;
        let vertex_attributes = [
            VertexInputAttributeDescription::default()
                .binding(0)
                .location(0)
                .format(Format::R32G32B32_SFLOAT)
                .offset(0),
            VertexInputAttributeDescription::default()
                .location(1)
                .binding(0)
                .format(Format::R32G32_SFLOAT)
                .offset(vec3_size),
            VertexInputAttributeDescription::default()
                .binding(0)
                .location(2)
                .format(Format::R32G32B32_SFLOAT)
                .offset(vec3_size + uv_size),
            VertexInputAttributeDescription::default()
                .location(3)
                .binding(0)
                .format(Format::R32G32_SFLOAT)
                .offset(2 * vec3_size + uv_size),
            VertexInputAttributeDescription::default()
                .binding(0)
                .location(4)
                .format(Format::R32G32B32_SFLOAT)
                .offset(2 * vec3_size + 2 * uv_size),
        ];
        let vertex_binding = &[VertexInputBindingDescription::default()
            .binding(0)
            .stride(std::mem::size_of::<Vertex>() as u32)];

        let vertex_state = PipelineVertexInputStateCreateInfo::default()
            .vertex_binding_descriptions(vertex_binding)
            .vertex_attribute_descriptions(&vertex_attributes);
        let mut pipeline_rendering_info = PipelineRenderingCreateInfo::default()
            .color_attachment_formats(&[Format::R16G16B16A16_SFLOAT]);
        // .depth_attachment_format(Format::D32_SFLOAT);
        let info = GraphicsPipelineCreateInfo::default()
            .stages(stages)
            .layout(layout)
            .dynamic_state(&dynamic_state)
            .vertex_input_state(&vertex_state)
            .input_assembly_state(&input_state)
            .rasterization_state(&raster_state)
            .viewport_state(&viewport_state)
            .multisample_state(&multisample_state)
            .depth_stencil_state(&depth_stencil_state)
            .color_blend_state(&color_blend_state)
            .push_next(&mut pipeline_rendering_info);
        device.create_graphics_pipeline(&info)
    }
}
