use {
    crate::{
        graph::{
            GpuDrawData, GpuMaterialData, GpuSceneData, Pipeline, RenderContext, RenderObject,
            FORMAT_DEPTH_IMAGE, FORMAT_DRAW_IMAGE,
        },
        mesh::Vertex,
        util::{
            self, PipelineColorBlend, PipelineColorBlendAttachment,
            PipelineColorBlendAttachmentStateExt, PipelineColorBlendStateCreateInfoExt,
            PipelineDepthStencil, PipelineDepthStencilStateCreateInfoExt, PipelineDynamicState,
            PipelineDynamicStateCreateInfoExt, PipelineInput,
            PipelineInputAssemblyStateCreateInfoExt, PipelineMultisampleStateCreateInfoExt,
            PipelineMultisampling, PipelineRasterization, PipelineRasterizationStateCreateInfoExt,
            PipelineViewport, PipelineViewportStateCreateInfoExt, ShaderStageFlags,
        },
        vk::{
            AttachmentLoadOp, AttachmentStoreOp, BufferDesc, BufferUsageFlags,
            ClearDepthStencilValue, ClearValue, ColorComponentFlags, CullModeFlags,
            DescriptorBufferInfo, DescriptorSetLayout, DescriptorSetLayoutCreateFlags,
            DescriptorType, Format, Gpu, GraphicsPipelineCreateInfo, Image, ImageLayout,
            Pipeline as VkPipeline, PipelineBindPoint, PipelineColorBlendAttachmentState,
            PipelineLayout, PipelineRenderingCreateInfo, PipelineVertexInputStateCreateInfo,
            Rect2D, RenderingAttachmentInfo, SharedBuffer, VertexInputAttributeDescription,
            VertexInputBindingDescription, Viewport, WriteDescriptorSet,
        },
    },
    anyhow::Result,
    ash::vk::{
        CompareOp, FrontFace, PipelineDepthStencilStateCreateFlags,
        PipelineDepthStencilStateCreateInfo, PipelineRasterizationStateCreateInfo,
        PipelineViewportStateCreateInfo,
    },
    glam::{vec3, vec4, Vec3},
    std::mem,
};

const SET_INDEX_SCENE: u32 = 0;
const SET_INDEX_MATERIAL: u32 = 1;
const SET_INDEX_DRAW: u32 = 2;

pub struct MeshPipeline {
    handle: VkPipeline,
    layout: PipelineLayout,
    material_buffer: SharedBuffer,
}

impl Pipeline for MeshPipeline {
    fn execute(&self, context: &RenderContext) -> Result<()> {
        let cmd = context.command_buffer;
        let color_attachments = &[util::color_attachment(context.draw_image)];
        let depth_attachment = &util::depth_attachment(context.depth_image);

        let extent = context.extent;
        cmd.begin_rendering(color_attachments, Some(depth_attachment), context.extent)?;
        let viewport = Viewport::default()
            .width(extent.width as f32)
            .height(0.0 - extent.height as f32)
            .x(0.)
            .y(extent.height as f32).min_depth(0.).max_depth(1.);
        cmd.set_viewport(viewport);

        let scissor = Rect2D::default().extent(extent);
        cmd.set_scissor(scissor);

        cmd.bind_pipeline(PipelineBindPoint::GRAPHICS, self.handle)?;
        for object in context.objects.objects.iter() {
            self.bind_object_descriptors(object, context);
            object.bind_mesh_buffers(cmd);
            object.draw(cmd);
        }
        cmd.end_rendering()?;
        Ok(())
    }
}

impl MeshPipeline {
    pub fn new(gpu: &Gpu, _texture_image: Image) -> Result<Self> {
        let descriptor_layout = Self::create_descriptor_layouts(gpu)?;
        let layout = gpu.create_pipeline_layout(&[descriptor_layout], &[])?;
        let handle = Self::create_pipeline(gpu, layout)?;
        let material_buffer = gpu.create_shared_buffer::<GpuSceneData>(
            BufferDesc::default()
                .size(mem::size_of::<GpuMaterialData>() as u64)
                .flags(BufferUsageFlags::TRANSFER_DST | BufferUsageFlags::UNIFORM_BUFFER)
                .label("material"),
        )?;

        let material_data = GpuMaterialData {
            albedo: vec4(0.0, 0.0, 1.0, 1.0),
            metallic: 1.0,
            roughness: 0.1,
            ao: 1.0,
            _padding: 0.,
        };

        material_buffer.write(&[material_data]);

        Ok(Self {
            handle,
            layout,
            material_buffer,
        })
    }

    fn create_descriptor_layouts(gpu: &Gpu) -> Result<DescriptorSetLayout> {
        let bindings = &[
            util::buffer_binding(
                SET_INDEX_SCENE,
                ShaderStageFlags::VERTEX | ShaderStageFlags::FRAGMENT,
            ),
            util::buffer_binding(
                SET_INDEX_MATERIAL,
                ShaderStageFlags::VERTEX | ShaderStageFlags::FRAGMENT,
            ),
            util::buffer_binding(
                SET_INDEX_DRAW,
                ShaderStageFlags::VERTEX | ShaderStageFlags::FRAGMENT,
            ),
        ];

        gpu.create_descriptor_set_layout(
            bindings,
            DescriptorSetLayoutCreateFlags::PUSH_DESCRIPTOR_KHR,
        )
    }

    fn bind_object_descriptors(&self, object: &RenderObject, context: &RenderContext) {
        let scene_info = &[DescriptorBufferInfo::default()
            .buffer(context.global_buffer.handle())
            .offset(0)
            .range(std::mem::size_of::<GpuSceneData>() as u64)];
        let draw_info = &[DescriptorBufferInfo::default()
            .buffer(object.model_buffer.handle())
            .offset(0)
            .range(std::mem::size_of::<GpuDrawData>() as u64)];
        let material_info = &[DescriptorBufferInfo::default()
            .buffer(self.material_buffer.handle())
            .offset(0)
            .range(std::mem::size_of::<GpuMaterialData>() as u64)];
        context.command_buffer.push_descriptor_set(
            PipelineBindPoint::GRAPHICS,
            self.layout,
            &[
                WriteDescriptorSet::default()
                    .dst_binding(SET_INDEX_SCENE)
                    .descriptor_count(1)
                    .descriptor_type(DescriptorType::UNIFORM_BUFFER)
                    .buffer_info(scene_info),
                WriteDescriptorSet::default()
                    .dst_binding(SET_INDEX_MATERIAL)
                    .descriptor_count(1)
                    .descriptor_type(DescriptorType::UNIFORM_BUFFER)
                    .buffer_info(material_info),
                WriteDescriptorSet::default()
                    .dst_binding(SET_INDEX_DRAW)
                    .descriptor_count(1)
                    .descriptor_type(DescriptorType::UNIFORM_BUFFER)
                    .buffer_info(draw_info),
            ],
            0,
        );
    }

    fn map_vertex_attributes() -> Vec<VertexInputAttributeDescription> {
        let vec3_size = std::mem::size_of::<Vec3>() as u32;
        vec![
            VertexInputAttributeDescription::default()
                .binding(0)
                .location(0)
                .format(Format::R32G32B32_SFLOAT)
                .offset(0),
            VertexInputAttributeDescription::default()
                .location(1)
                .binding(0)
                .format(Format::R32G32B32_SFLOAT)
                .offset(vec3_size),
            VertexInputAttributeDescription::default()
                .location(2)
                .binding(0)
                .format(Format::R32G32_SFLOAT)
                .offset(vec3_size * 2),
        ]
    }

    fn create_pipeline(gpu: &Gpu, layout: PipelineLayout) -> Result<VkPipeline> {
        let (_vs_module, vs_stage) =
            util::load_shader("shaders/mesh.vert.spv", gpu, ShaderStageFlags::VERTEX)?;
        let (_fs_module, fs_stage) =
            util::load_shader("shaders/mesh.frag.spv", gpu, ShaderStageFlags::FRAGMENT)?;
        let stages = &[vs_stage, fs_stage];
        let dynamic_state = PipelineDynamicState::viewport_and_scissor();
        let input = PipelineInput::triangle_list();
        let raster = PipelineRasterization::filled(CullModeFlags::NONE, FrontFace::COUNTER_CLOCKWISE);
        let multisampling = PipelineMultisampling::disabled();
        let viewport = PipelineViewport::single_viewport_scissor();
        let depth_info = PipelineDepthStencil::enabled(CompareOp::LESS_OR_EQUAL);
        let attachments = &[PipelineColorBlendAttachment::disabled()];
        let color_blend = PipelineColorBlend::disabled(attachments);
        let vertex_attributes = Self::map_vertex_attributes();
        let vertex_binding = &[VertexInputBindingDescription::default()
            .binding(0)
            .stride(std::mem::size_of::<Vertex>() as u32)];

        let vertex_state = PipelineVertexInputStateCreateInfo::default()
            .vertex_binding_descriptions(vertex_binding)
            .vertex_attribute_descriptions(&vertex_attributes);
        let mut pipeline_rendering_info = PipelineRenderingCreateInfo::default()
            .color_attachment_formats(&[FORMAT_DRAW_IMAGE])
            .depth_attachment_format(FORMAT_DEPTH_IMAGE);
        let info = GraphicsPipelineCreateInfo::default()
            .stages(stages)
            .layout(layout)
            .dynamic_state(&dynamic_state)
            .vertex_input_state(&vertex_state)
            .input_assembly_state(&input)
            .rasterization_state(&raster)
            .viewport_state(&viewport)
            .multisample_state(&multisampling)
            .depth_stencil_state(&depth_info)
            .color_blend_state(&color_blend)
            .push_next(&mut pipeline_rendering_info);
        gpu.create_graphics_pipeline(&info)
    }
}
