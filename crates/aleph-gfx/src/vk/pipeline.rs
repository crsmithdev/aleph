use {
    super::{buffer::RawBuffer, Buffer, CommandBuffer, Gpu, Texture, VkPipeline},
    crate::{render::renderer::RenderContext, Vertex},
    anyhow::Result,
    ash::vk::{self, PipelineBindPoint, SampleCountFlags},
    bytemuck::Pod,
    std::{collections::HashSet, ffi},
};
pub trait Pipeline {
    fn execute(&self, context: &RenderContext) -> Result<()>;
}

const SHADER_MAIN: &ffi::CStr = c"main";
pub struct PipelineBuilder<'a> {
    color_blend: vk::PipelineColorBlendStateCreateInfo<'a>,
    depth: vk::PipelineDepthStencilStateCreateInfo<'a>,
    viewport: vk::PipelineViewportStateCreateInfo<'a>,
    input_assembly: vk::PipelineInputAssemblyStateCreateInfo<'a>,
    rasterization: vk::PipelineRasterizationStateCreateInfo<'a>,
    multisample: vk::PipelineMultisampleStateCreateInfo<'a>,
    vertex_shader: vk::ShaderModule,
    fragment_shader: vk::ShaderModule,
    vertex_bindings: Vec<vk::VertexInputBindingDescription>,
    vertex_attributes: Vec<vk::VertexInputAttributeDescription>,
    color_blend_formats: HashSet<vk::Format, std::hash::RandomState>,
    depth_format: vk::Format,
    dynamic_states: HashSet<vk::DynamicState>,
}

impl Default for PipelineBuilder<'_> {
    fn default() -> Self {
        Self {
            color_blend: vk::PipelineColorBlendStateCreateInfo::default().logic_op_enable(false),
            depth: vk::PipelineDepthStencilStateCreateInfo::default(),
            viewport: vk::PipelineViewportStateCreateInfo::default()
                .viewport_count(1)
                .scissor_count(1),
            input_assembly: vk::PipelineInputAssemblyStateCreateInfo::default()
                .topology(vk::PrimitiveTopology::TRIANGLE_LIST),
            multisample: vk::PipelineMultisampleStateCreateInfo::default(),
            rasterization: vk::PipelineRasterizationStateCreateInfo::default()
                .polygon_mode(vk::PolygonMode::FILL)
                .cull_mode(vk::CullModeFlags::NONE)
                .front_face(vk::FrontFace::COUNTER_CLOCKWISE)
                .line_width(1.0),
            vertex_shader: vk::ShaderModule::null(),
            fragment_shader: vk::ShaderModule::null(),
            vertex_attributes: vec![],
            vertex_bindings: vec![],
            depth_format: vk::Format::D32_SFLOAT,
            color_blend_formats: HashSet::from_iter(vec![vk::Format::R16G16B16A16_SFLOAT]),
            dynamic_states: HashSet::new(),
        }
    }
}

impl<'a> PipelineBuilder<'a> {
    pub fn build(&self, gpu: &Gpu, layout: vk::PipelineLayout) -> Result<VkPipeline> {
        let vertex_stage = vk::PipelineShaderStageCreateInfo::default()
            .stage(vk::ShaderStageFlags::VERTEX)
            .module(self.vertex_shader)
            .name(SHADER_MAIN);
        let fragment_stage = vk::PipelineShaderStageCreateInfo::default()
            .stage(vk::ShaderStageFlags::FRAGMENT)
            .module(self.fragment_shader)
            .name(SHADER_MAIN);
        // TODO no shader condition
        let stages = &[vertex_stage, fragment_stage];
        let vertex_attributes = &self.vertex_attributes;
        let vertex_binding = &self.vertex_bindings;
        let vertex_state = vk::PipelineVertexInputStateCreateInfo::default()
            .vertex_binding_descriptions(vertex_binding)
            .vertex_attribute_descriptions(vertex_attributes);
        let color_formats = self.color_blend_formats.iter().copied().collect::<Vec<_>>();
        let mut rendering_info = vk::PipelineRenderingCreateInfo::default()
            .color_attachment_formats(&color_formats)
            .depth_attachment_format(self.depth_format);
        let dynamic_states = self.dynamic_states.iter().copied().collect::<Vec<_>>();
        let dynamic_state =
            vk::PipelineDynamicStateCreateInfo::default().dynamic_states(&dynamic_states);
        let info = vk::GraphicsPipelineCreateInfo::default()
            .stages(stages)
            .layout(layout)
            .dynamic_state(&dynamic_state)
            .vertex_input_state(&vertex_state)
            .input_assembly_state(&self.input_assembly)
            .rasterization_state(&self.rasterization)
            .viewport_state(&self.viewport)
            .multisample_state(&self.multisample)
            .depth_stencil_state(&self.depth)
            .color_blend_state(&self.color_blend)
            .input_assembly_state(&self.input_assembly)
            .push_next(&mut rendering_info);
        gpu.create_graphics_pipeline(&info)
    }

    pub fn color_blend_formats(&mut self, formats: &'a [vk::Format]) -> &mut Self {
        formats.iter().for_each(|&format| {
            self.color_blend_formats.insert(format);
        });
        self
    }
    pub fn depth_format(&mut self, format: vk::Format) -> &mut Self {
        self.depth_format = format;
        self
    }
    pub fn vertex_attributes(&mut self, attributes: &'a [(u32, vk::Format)]) -> &mut Self {
        self.vertex_bindings = vec![vk::VertexInputBindingDescription::default()
            .binding(0)
            .stride(std::mem::size_of::<Vertex>() as u32)];
        self.vertex_attributes = attributes
            .iter()
            .enumerate()
            .map(|(i, (offset, format))| {
                vk::VertexInputAttributeDescription::default()
                    .binding(0)
                    .location(i as u32)
                    .format(*format)
                    .offset(*offset)
            })
            .collect::<Vec<_>>();
        self
    }

    pub fn blend_disabled(
        &mut self,
        attachments: &'a [vk::PipelineColorBlendAttachmentState],
    ) -> &mut Self {
        self.color_blend = self
            .color_blend
            .logic_op_enable(false)
            .attachments(attachments);
        self
    }

    pub fn blend_enabled(
        &mut self,
        attachments: &'a [vk::PipelineColorBlendAttachmentState],
    ) -> &mut Self {
        self.color_blend = self
            .color_blend
            .logic_op_enable(false)
            .attachments(attachments);
        self
    }

    pub fn depth_enabled(&mut self, compare_op: vk::CompareOp) -> &mut Self {
        self.depth = self
            .depth
            .depth_compare_op(compare_op)
            .depth_test_enable(true)
            .depth_write_enable(true)
            .min_depth_bounds(0.)
            .max_depth_bounds(1.);
        self
    }

    pub fn depth_disabled(&mut self) -> &mut Self {
        self.depth = self
            .depth
            .depth_test_enable(false)
            .depth_write_enable(false)
            .depth_compare_op(vk::CompareOp::LESS_OR_EQUAL);
        self
    }

    pub fn multisampling_disabled(&mut self) -> &mut Self {
        self.multisample = self
            .multisample
            .rasterization_samples(SampleCountFlags::TYPE_1);
        self
    }

    pub fn polygon_mode(&mut self, mode: vk::PolygonMode) -> &mut Self {
        self.rasterization = self.rasterization.polygon_mode(mode);
        self
    }

    pub fn input_topology(&mut self, topology: vk::PrimitiveTopology) -> &mut Self {
        self.input_assembly = self.input_assembly.topology(topology);
        self
    }

    pub fn winding(
        &mut self,
        front_face: vk::FrontFace,
        cull_mode: vk::CullModeFlags,
    ) -> &mut Self {
        self.rasterization = self
            .rasterization
            .cull_mode(cull_mode)
            .front_face(front_face);
        self
    }

    pub fn dynamic_scissor(&mut self) -> &mut Self {
        self.viewport = self.viewport.scissor_count(1);
        self.dynamic_states.insert(vk::DynamicState::SCISSOR);
        self
    }

    pub fn dynamic_viewport(&mut self) -> &mut Self {
        self.viewport = self.viewport.viewport_count(1);
        self.dynamic_states.insert(vk::DynamicState::VIEWPORT);
        self
    }

    pub fn vertex_shader(&mut self, shader: vk::ShaderModule) -> &mut Self {
        self.vertex_shader = shader;
        self
    }

    pub fn fragment_shader(&mut self, shader: vk::ShaderModule) -> &mut Self {
        self.fragment_shader = shader;
        self
    }
}

#[derive(Default)]
pub struct ResourceLayout<'a> {
    pub(crate) bindings: Vec<vk::DescriptorSetLayoutBinding<'a>>,
}

impl ResourceLayout<'_> {
    pub fn layout(&self, gpu: &Gpu) -> Result<vk::DescriptorSetLayout> {
        gpu.create_descriptor_set_layout(
            &self.bindings,
            vk::DescriptorSetLayoutCreateFlags::PUSH_DESCRIPTOR_KHR,
        )
    }

    pub fn buffer(&mut self, index: u32, flags: vk::ShaderStageFlags) -> &mut Self {
        self.bindings.push(
            vk::DescriptorSetLayoutBinding::default()
                .binding(index)
                .descriptor_count(1)
                .stage_flags(flags)
                .descriptor_type(vk::DescriptorType::UNIFORM_BUFFER),
        );

        self
    }

    pub fn image(&mut self, index: u32, flags: vk::ShaderStageFlags) -> &mut Self {
        self.bindings.push(
            vk::DescriptorSetLayoutBinding::default()
                .binding(index)
                .descriptor_count(1)
                .stage_flags(flags)
                .descriptor_type(vk::DescriptorType::COMBINED_IMAGE_SAMPLER),
        );

        self
    }
}

#[derive(Default)]
pub struct ResourceBinder<'a> {
    bindings: Vec<BoundResource<'a>>,
}

impl<'a> ResourceBinder<'a> {
    pub fn buffer<T: Pod>(&mut self, index: u32, buffer: &'a Buffer<T>) -> &mut Self {
        let resource = BoundResource::Buffer {
            index,
            buffer: buffer.raw(),
            size: buffer.size(),
            offset: 0,
        };

        self.bindings.push(resource);
        self
    }

    pub fn image(&mut self, index: u32, image: &'a Texture, sampler: vk::Sampler) -> &mut Self {
        let resource = BoundResource::Image { index, image, sampler };
        self.bindings.push(resource);
        self
    }

    pub fn bind(&self, cmd: &CommandBuffer, layout: &vk::PipelineLayout) {
        let mut buffer_infos = vec![];
        let mut buffer_writes = vec![];
        let mut image_infos = vec![];
        let mut image_writes = vec![];

        for binding in &self.bindings {
            match binding {
                BoundResource::Buffer {
                    index,
                    buffer,
                    size,
                    offset,
                } => {
                    let (info, write) = self.write_buffer(buffer, *index, *size, *offset);
                    buffer_infos.push([info]);
                    buffer_writes.push(write);
                }
                BoundResource::Image { index, image, sampler } => {
                    let (info, write) = self.write_image(image, *sampler, *index);
                    image_infos.push([info]);
                    image_writes.push(write);
                }
            }
        }

        for i in 0..buffer_infos.len() {
            buffer_writes[i] = buffer_writes[i].buffer_info(&buffer_infos[i]);
        }
        for i in 0..image_infos.len() {
            image_writes[i] = image_writes[i].image_info(&image_infos[i]);
        }

        cmd.push_descriptor_set(PipelineBindPoint::GRAPHICS, *layout, &buffer_writes, 0);
        cmd.push_descriptor_set(PipelineBindPoint::GRAPHICS, *layout, &image_writes, 0);
    }

    fn write_image(
        &self,
        image: &Texture,
        sampler: vk::Sampler,
        index: u32,
    ) -> (vk::DescriptorImageInfo, vk::WriteDescriptorSet) {
        let info = vk::DescriptorImageInfo::default()
            .image_layout(vk::ImageLayout::SHADER_READ_ONLY_OPTIMAL)
            .image_view(image.view())
            .sampler(sampler);
        let write = vk::WriteDescriptorSet::default()
            .dst_binding(index)
            .descriptor_count(1)
            .descriptor_type(vk::DescriptorType::COMBINED_IMAGE_SAMPLER);

        (info, write)
    }

    fn write_buffer(
        &self,
        buffer: &RawBuffer,
        index: u32,
        size: u64,
        offset: u64,
    ) -> (vk::DescriptorBufferInfo, vk::WriteDescriptorSet) {
        let info = vk::DescriptorBufferInfo::default()
            .buffer(buffer.handle())
            .offset(offset)
            .range(size);
        let write = vk::WriteDescriptorSet::default()
            .dst_binding(index)
            .descriptor_count(1)
            .descriptor_type(vk::DescriptorType::UNIFORM_BUFFER);
        (info, write)
    }
}

pub enum BoundResource<'a> {
    Buffer {
        index: u32,
        buffer: &'a RawBuffer,
        size: u64,
        offset: u64,
    },
    Image {
        index: u32,
        sampler: vk::Sampler,
        image: &'a Texture,
    },
}
