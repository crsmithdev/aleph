use {
    crate::{
        graph::{GpuGlobalData, GpuModelData, Pipeline, RenderContext, RenderObject},
        mesh::Vertex,
        util::{self, ShaderStageFlags},
    },
    aleph_hal::{
        Buffer,
        CommandBuffer,
        Device,
        Format,
        Frame,
        Gpu,
        Image,
        ImageInfo,
        ImageUsageFlags,
    },
    anyhow::Result,
    ash::vk::{
        self, AttachmentLoadOp as LoadOp, AttachmentStoreOp as StoreOp, PipelineBindPoint, VertexInputBindingDescription
    },
    nalgebra::Vector4,
};

const BINDING_INDEX_CONFIG_UBO: u32 = 0;
const BINDING_INDEX_MODEL_UBO: u32 = 1;
// const BINDING_INDEX_TEXTURE: u32 = 2;

pub struct MeshPipeline {
    pipeline: vk::Pipeline,
    pipeline_layout: vk::PipelineLayout,
    descriptor_layout: vk::DescriptorSetLayout,
    texture_image: Image,
    texture_sampler: vk::Sampler,
}

impl Pipeline for MeshPipeline {
    fn execute(&self, context: &RenderContext) -> Result<()> {

        let cmd = context.command_buffer;
        let color_attachments = &[vk::RenderingAttachmentInfo::default()
            .image_view(context.draw_image.view)
            .image_layout(vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL)];
        // let depth_attachment = &util::depth_attachment(
        //     context.depth_image,
        //     LoadOp::CLEAR,
        //     StoreOp::STORE,
        //     clear_value,
        // );
        let depth_attachment = None;

        let extent = context.extent;
        cmd.begin_rendering(color_attachments, depth_attachment, context.extent)?;
        let viewport = vk::Viewport::default()
            .width(extent.width as f32)
            .height(0.0 - extent.height as f32)
            .x(0.)
            .y(extent.height as f32)
            .max_depth(1.0);
        cmd.set_viewport(viewport);

        let scissor = vk::Rect2D::default().extent(extent);
        cmd.set_scissor(scissor);

        cmd.bind_pipeline(vk::PipelineBindPoint::GRAPHICS, self.pipeline)?;
        self.bind_global_descriptors(context);
        for object in context.objects {
            self.bind_object_descriptors(object);
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
        let sampler_info = vk::SamplerCreateInfo::default()
            .mag_filter(vk::Filter::LINEAR)
            .min_filter(vk::Filter::LINEAR);
        let texture_sampler = unsafe { gpu.device().create_sampler(&sampler_info, None)? };

        Ok(Self {
            pipeline,
            pipeline_layout,
            descriptor_layout,
            texture_image,
            texture_sampler,
        })
    }

    fn create_descriptor_layout(device: &Device) -> Result<vk::DescriptorSetLayout> {
        let bindings = &[
            util::buffer_binding(
                BINDING_INDEX_CONFIG_UBO,
                ShaderStageFlags::VERTEX,
            ),
        ];

        device.create_descriptor_set_layout(
            bindings,
            vk::DescriptorSetLayoutCreateFlags::PUSH_DESCRIPTOR_KHR,
        )
    }

    fn bind_object_descriptors(&self, context: &RenderContext) {
        // ...
    }

    fn bind_global_descriptors(&self, context: &RenderContext) {
        let info = &[vk::DescriptorBufferInfo::default()
            .buffer(context.global_buffer.handle())
            .offset(0)
            .range(std::mem::size_of::<GpuGlobalData>() as u64)];
        let writes = &[vk::WriteDescriptorSet::default()
            .dst_binding(BINDING_INDEX_CONFIG_UBO)
            .descriptor_count(1)
            .descriptor_type(vk::DescriptorType::UNIFORM_BUFFER)
            .buffer_info(info)];
        context.command_buffer.push_descriptor_sets(PipelineBindPoint::GRAPHICS, self.pipeline_layout, writes);
        // let buffer_info2 = &[vk::DescriptorBufferInfo::default()
        //     .buffer(object.model_buffer.handle())
        //     .offset(0)
        //     .range(std::mem::size_of::<GpuModelData>() as u64)];
        // let buffer_write2 = vk::WriteDescriptorSet::default()
        //     .dst_binding(BINDING_INDEX_MODEL_UBO)
        //     .descriptor_count(1)
        //     .descriptor_type(vk::DescriptorType::UNIFORM_BUFFER)
        // .buffer_info(buffer_info2);
        // let image_info = &[vk::DescriptorImageInfo::default()
        //     .image_layout(vk::ImageLayout::SHADER_READ_ONLY_OPTIMAL)
        //     .image_view(self.texture_image.view)
        //     .sampler(self.texture_sampler)];
        // let image_write = vk::WriteDescriptorSet::default()
        //     .dst_binding(BINDING_INDEX_TEXTURE)
        //     .descriptor_count(1)
        //     .descriptor_type(vk::DescriptorType::COMBINED_IMAGE_SAMPLER)
        //     .image_info(image_info);

        let writes = &[buffer_write1];

        context.command_buffer.push_descriptor_sets(
            vk::PipelineBindPoint::GRAPHICS,
            self.pipeline_layout,
            writes,
        );
    }

    fn create_pipeline(device: &Device, layout: vk::PipelineLayout) -> Result<vk::Pipeline> {
        let (_vs_module, vs_stage) = util::load_shader(
            "shaders/mesh.vert.spv",
            device,
            vk::ShaderStageFlags::VERTEX,
        )?;
        let (_fs_module, fs_stage) = util::load_shader(
            "shaders/mesh.frag.spv",
            device,
            vk::ShaderStageFlags::FRAGMENT,
        )?;
        let stages = &[vs_stage, fs_stage];
        let dynamic_state = util::dynamic_state_default();
        let input_state = util::input_state_triangle_list();
        let raster_state = util::raster_state_polygons(vk::CullModeFlags::BACK).front_face(vk::FrontFace::COUNTER_CLOCKWISE);
        let multisample_state = util::multisample_state_disabled();
        let viewport_state = util::viewport_state_default();
        // let depth_stencil_state = util::depth_stencil_enabled();
        let depth_stencil_state = vk::PipelineDepthStencilStateCreateInfo::default();
        let attachments = &[vk::PipelineColorBlendAttachmentState::default()
            .blend_enable(false)
            .color_write_mask(
                vk::ColorComponentFlags::A
                    | vk::ColorComponentFlags::R
                    | vk::ColorComponentFlags::G
                    | vk::ColorComponentFlags::B,
            )];
        let color_blend_state = util::color_blend_disabled(attachments);
        let vertex_attributes = [vk::VertexInputAttributeDescription::default()
            .location(0)
            .binding(0)
            .format(vk::Format::R32G32_SFLOAT)
            .offset(0)];
        let vertex_bindings = [vk::VertexInputBindingDescription::default()
            .binding(0)
            .stride(std::mem::size_of::<Vertex>() as u32)
            .input_rate(vk::VertexInputRate::VERTEX)];
        let vertex_state = vk::PipelineVertexInputStateCreateInfo::default()
            .vertex_attribute_descriptions(&vertex_attributes)
            .vertex_binding_descriptions(&vertex_bindings);

        let mut pipeline_rendering_info = vk::PipelineRenderingCreateInfo::default()
            .color_attachment_formats(&[vk::Format::R16G16B16A16_SFLOAT])
            .depth_attachment_format(vk::Format::D32_SFLOAT);
        let info = vk::GraphicsPipelineCreateInfo::default()
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

