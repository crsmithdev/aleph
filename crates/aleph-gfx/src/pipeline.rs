use {
    crate::RenderContext,
    aleph_scene::Vertex,
    aleph_vk::{
        CompareOp, CullModeFlags, DynamicState, Format, FrontFace, Gpu, GraphicsPipelineCreateInfo,
        PipelineColorBlendAttachmentState, PipelineColorBlendStateCreateInfo,
        PipelineDepthStencilStateCreateInfo, PipelineDynamicStateCreateInfo,
        PipelineInputAssemblyStateCreateInfo, PipelineLayout, PipelineMultisampleStateCreateInfo,
        PipelineRasterizationStateCreateInfo, PipelineRenderingCreateInfo,
        PipelineShaderStageCreateInfo, PipelineVertexInputStateCreateInfo,
        PipelineViewportStateCreateInfo, PolygonMode, PrimitiveTopology, SampleCountFlags,
        ShaderModule, ShaderStageFlags, VertexInputAttributeDescription,
        VertexInputBindingDescription, VkPipeline,
    },
    anyhow::Result,
    std::{collections::HashSet, ffi},
};

pub trait Pipeline {
    fn render(&mut self, context: &RenderContext) -> Result<()>;
}

const SHADER_MAIN: &ffi::CStr = c"main";
pub struct PipelineBuilder<'a> {
    color_blend: PipelineColorBlendStateCreateInfo<'a>,
    depth: PipelineDepthStencilStateCreateInfo<'a>,
    viewport: PipelineViewportStateCreateInfo<'a>,
    input_assembly: PipelineInputAssemblyStateCreateInfo<'a>,
    rasterization: PipelineRasterizationStateCreateInfo<'a>,
    multisample: PipelineMultisampleStateCreateInfo<'a>,
    vertex_shader: ShaderModule,
    fragment_shader: ShaderModule,
    geometry_shader: ShaderModule,
    vertex_bindings: Vec<VertexInputBindingDescription>,
    vertex_attributes: Vec<VertexInputAttributeDescription>,
    color_blend_formats: HashSet<Format, std::hash::RandomState>,
    depth_format: Format,
    dynamic_states: HashSet<DynamicState>,
}

impl Default for PipelineBuilder<'_> {
    fn default() -> Self {
        Self {
            color_blend: PipelineColorBlendStateCreateInfo::default().logic_op_enable(false),
            depth: PipelineDepthStencilStateCreateInfo::default(),
            viewport: PipelineViewportStateCreateInfo::default()
                .viewport_count(1)
                .scissor_count(1),
            input_assembly: PipelineInputAssemblyStateCreateInfo::default()
                .topology(PrimitiveTopology::TRIANGLE_LIST),
            multisample: PipelineMultisampleStateCreateInfo::default(),
            rasterization: PipelineRasterizationStateCreateInfo::default()
                .polygon_mode(PolygonMode::FILL)
                .cull_mode(CullModeFlags::NONE)
                .front_face(FrontFace::COUNTER_CLOCKWISE)
                .line_width(1.0),
            vertex_shader: ShaderModule::null(),
            fragment_shader: ShaderModule::null(),
            geometry_shader: ShaderModule::null(),
            vertex_attributes: vec![],
            vertex_bindings: vec![],
            depth_format: Format::D32_SFLOAT,
            color_blend_formats: HashSet::from_iter(vec![Format::R16G16B16A16_SFLOAT]),
            dynamic_states: HashSet::new(),
        }
    }
}

impl<'a> PipelineBuilder<'a> {
    pub fn build(&self, gpu: &Gpu, layout: PipelineLayout) -> Result<VkPipeline> {
        let vertex_stage = PipelineShaderStageCreateInfo::default()
            .stage(ShaderStageFlags::VERTEX)
            .module(self.vertex_shader)
            .name(SHADER_MAIN);
        let fragment_stage = PipelineShaderStageCreateInfo::default()
            .stage(ShaderStageFlags::FRAGMENT)
            .module(self.fragment_shader)
            .name(SHADER_MAIN);
        let geometry_stage = PipelineShaderStageCreateInfo::default()
            .stage(ShaderStageFlags::GEOMETRY)
            .module(self.geometry_shader)
            .name(SHADER_MAIN);
        // TODO no shader condition
        let mut stages = vec![];
        if self.vertex_shader != ShaderModule::null() {
            stages.push(vertex_stage);
        }
        if self.fragment_shader != ShaderModule::null() {
            stages.push(fragment_stage);
        }
        if self.geometry_shader != ShaderModule::null() {
            stages.push(geometry_stage);
        }
        let vertex_attributes = &self.vertex_attributes;
        let vertex_binding = &self.vertex_bindings;
        let vertex_state = PipelineVertexInputStateCreateInfo::default()
            .vertex_binding_descriptions(vertex_binding)
            .vertex_attribute_descriptions(vertex_attributes);
        let color_formats = self.color_blend_formats.iter().copied().collect::<Vec<_>>();
        let mut rendering_info = PipelineRenderingCreateInfo::default()
            .color_attachment_formats(&color_formats)
            .depth_attachment_format(self.depth_format);
        let dynamic_states = self.dynamic_states.iter().copied().collect::<Vec<_>>();
        let dynamic_state =
            PipelineDynamicStateCreateInfo::default().dynamic_states(&dynamic_states);
        let info = GraphicsPipelineCreateInfo::default()
            .stages(&stages)
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

    pub fn color_blend_formats(&mut self, formats: &'a [Format]) -> &mut Self {
        formats.iter().for_each(|&format| {
            self.color_blend_formats.insert(format);
        });
        self
    }
    pub fn depth_format(&mut self, format: Format) -> &mut Self {
        self.depth_format = format;
        self
    }
    pub fn vertex_attributes(&mut self, attributes: &'a [(u32, Format)]) -> &mut Self {
        self.vertex_bindings = vec![VertexInputBindingDescription::default()
            .binding(0)
            .stride(std::mem::size_of::<Vertex>() as u32)];
        self.vertex_attributes = attributes
            .iter()
            .enumerate()
            .map(|(i, (offset, format))| {
                VertexInputAttributeDescription::default()
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
        attachments: &'a [PipelineColorBlendAttachmentState],
    ) -> &mut Self {
        self.color_blend = self
            .color_blend
            .logic_op_enable(false)
            .attachments(attachments);
        self
    }

    pub fn blend_enabled(
        &mut self,
        attachments: &'a [PipelineColorBlendAttachmentState],
    ) -> &mut Self {
        self.color_blend = self
            .color_blend
            .logic_op_enable(false)
            .attachments(attachments);
        self
    }

    pub fn depth_enabled(&mut self, compare_op: CompareOp) -> &mut Self {
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
            .depth_compare_op(CompareOp::LESS_OR_EQUAL);
        self
    }

    pub fn multisampling_disabled(&mut self) -> &mut Self {
        self.multisample = self
            .multisample
            .rasterization_samples(SampleCountFlags::TYPE_1);
        self
    }

    pub fn polygon_mode(&mut self, mode: PolygonMode) -> &mut Self {
        self.rasterization = self.rasterization.polygon_mode(mode);
        self
    }

    pub fn input_topology(&mut self, topology: PrimitiveTopology) -> &mut Self {
        self.input_assembly = self.input_assembly.topology(topology);
        self
    }

    pub fn winding(&mut self, front_face: FrontFace, cull_mode: CullModeFlags) -> &mut Self {
        self.rasterization = self
            .rasterization
            .cull_mode(cull_mode)
            .front_face(front_face);
        self
    }

    pub fn dynamic_scissor(&mut self) -> &mut Self {
        self.viewport = self.viewport.scissor_count(1);
        self.dynamic_states.insert(DynamicState::SCISSOR);
        self
    }

    pub fn dynamic_viewport(&mut self) -> &mut Self {
        self.viewport = self.viewport.viewport_count(1);
        self.dynamic_states.insert(DynamicState::VIEWPORT);
        self
    }

    pub fn dynamic_line_width(&mut self) -> &mut Self {
        self.rasterization = self.rasterization.line_width(1.0);
        self.dynamic_states.insert(DynamicState::LINE_WIDTH);
        self
    }

    pub fn vertex_shader(&mut self, shader: ShaderModule) -> &mut Self {
        self.vertex_shader = shader;
        self
    }

    pub fn fragment_shader(&mut self, shader: ShaderModule) -> &mut Self {
        self.fragment_shader = shader;
        self
    }

    pub fn geometry_shader(&mut self, shader: ShaderModule) -> &mut Self {
        self.geometry_shader = shader;
        self
    }
}

// #[derive(Default)]
// pub struct ResourceLayout<'a> {
//     pub(crate) bindings: Vec<DescriptorSetLayoutBinding<'a>>,
// }

// impl ResourceLayout<'_> {
//     pub fn set(set: u32) -> Self { Self { bindings: vec![] } }

//     pub fn dynamic_uniform(&mut self, index: u32, flags: ShaderStageFlags) -> &mut Self {
//         self.bindings.push(
//             DescriptorSetLayoutBinding::default()
//                 .binding(index)
//                 .descriptor_count(1)
//                 .stage_flags(flags)
//                 .descriptor_type(DescriptorType::UNIFORM_BUFFER_DYNAMIC),
//         );
//         self
//     }

//     pub fn uniform(&mut self, index: u32, flags: ShaderStageFlags) -> &mut Self {
//         self.bindings.push(
//             DescriptorSetLayoutBinding::default()
//                 .binding(index)
//                 .descriptor_count(1)
//                 .stage_flags(flags)
//                 .descriptor_type(DescriptorType::UNIFORM_BUFFER),
//         );
//         self
//     }

//     pub fn texture(&mut self, index: u32, flags: ShaderStageFlags) -> &mut Self {
//         self.bindings.push(
//             DescriptorSetLayoutBinding::default()
//                 .binding(index)
//                 .descriptor_count(1)
//                 .stage_flags(flags)
//                 .descriptor_type(DescriptorType::COMBINED_IMAGE_SAMPLER),
//         );
//         self
//     }

//     pub fn pool_sizes(&self) -> Vec<DescriptorPoolSize> {
//         let mut counter = HashMap::new();
//         self.bindings.iter().for_each(|binding| {
//             let descriptor_type = binding.descriptor_type;
//             counter
//                 .entry(descriptor_type)
//                 .and_modify(|v| *v += 1)
//                 .or_insert(1);
//         });
//         counter
//             .iter()
//             .map(|(k, v)| DescriptorPoolSize::default().descriptor_count(*v).ty(*k))
//             .collect()
//     }

//     pub fn create_descriptor_set(&self, gpu: &Gpu) -> Result<(DescriptorSet, DescriptorSetLayout)> {
//         let layout = self.create_layout(gpu)?;
//         let pool_sizes = self.pool_sizes();
//         let pool = gpu.create_descriptor_pool(
//             &pool_sizes,
//             DescriptorPoolCreateFlags::UPDATE_AFTER_BIND,
//             1,
//         )?;

//         let set = gpu.create_descriptor_set(layout, pool)?;
//         Ok((set, layout))
//     }

//     pub fn create_layout(&self, gpu: &Gpu) -> Result<DescriptorSetLayout> {
//         gpu.create_descriptor_set_layout(
//             &self.bindings,
//             DescriptorSetLayoutCreateFlags::UPDATE_AFTER_BIND_POOL,
//         )
//     }
// }

// pub struct ResourceBinder<'a> {
//     bindings: Vec<BoundResource<'a>>,
//     set: DescriptorSet,
// }

// impl<'a> ResourceBinder<'a> {
//     pub fn set(set: DescriptorSet) -> Self {
//         Self {
//             bindings: vec![],
//             set,
//         }
//     }

//     pub fn uniform<T: Pod>(&mut self, index: u32, buffer: &'a Buffer<T>) -> &mut Self {
//         let resource = BoundResource::Buffer {
//             info: DescriptorBufferInfo::default()
//                 .buffer(buffer.handle())
//                 .offset(0)
//                 .range(buffer.size()),
//             index,
//             buffer: buffer.raw(),
//             size: buffer.size(),
//             offset: 0,
//         };

//         self.bindings.push(resource);
//         self
//     }

//     pub fn dynamic_uniform<T: Pod>(
//         &mut self,
//         index: u32,
//         buffer: &'a Buffer<T>,
//         offset: u64,
//         range: u64,
//     ) -> &mut Self {
//         let resource = BoundResource::DynamicUniform {
//             info: DescriptorBufferInfo::default()
//                 .buffer(buffer.handle())
//                 .offset(offset)
//                 .range(range),
//             index,
//             buffer: buffer.raw(),
//             size: buffer.size(),
//             offset,
//             range,
//         };

//         self.bindings.push(resource);
//         self
//     }

//     pub fn texture(
//         &mut self,
//         index: u32,
//         image: &'a AllocatedTexture,
//         sampler: Sampler,
//     ) -> &mut Self {
//         let resource = BoundResource::Texture {
//             info: DescriptorImageInfo::default()
//                 .image_layout(ImageLayout::SHADER_READ_ONLY_OPTIMAL)
//                 .image_view(image.view())
//                 .sampler(sampler),
//             index,
//             image,
//             sampler,
//         };
//         self.bindings.push(resource);
//         self
//     }

//     pub fn update(&self, ctx: &RenderContext) -> Result<&Self> {
//         let writes = self
//             .bindings
//             .iter()
//             .map(|binding| self.extract2(binding))
//             .collect::<Vec<_>>();
//         ctx.cmd_buffer
//             .update_descriptor_set(&writes.as_slice(), &[]);
//         Ok(self)
//     }

//     fn extract(&self, binding: &BoundResource) -> WriteThing<'a> {
//         match binding {
//             BoundResource::DynamicUniform { index, info, .. } => {
//                 let write = WriteDescriptorSet::default()
//                     .dst_set(self.set)
//                     .dst_binding(*index)
//                     .descriptor_count(1)
//                     .descriptor_type(DescriptorType::UNIFORM_BUFFER_DYNAMIC);
//                 WriteThing::Buffer(write, *info)
//             }
//             BoundResource::Buffer { index, info, .. } => {
//                 let write = WriteDescriptorSet::default()
//                     .dst_set(self.set)
//                     .dst_binding(*index)
//                     .descriptor_count(1)
//                     .descriptor_type(DescriptorType::UNIFORM_BUFFER);
//                 WriteThing::Buffer(write, *info)
//             }
//             BoundResource::Texture { index, info, .. } => {
//                 let write = WriteDescriptorSet::default()
//                     .dst_set(self.set)
//                     .dst_binding(*index)
//                     .descriptor_count(1)
//                     .descriptor_type(DescriptorType::COMBINED_IMAGE_SAMPLER);
//                 WriteThing::Image(write, *info)
//             }
//         }
//     }

//     fn extract2(&self, binding: &BoundResource) -> WriteDescriptorSet<'a> {
//         match binding {
//             BoundResource::DynamicUniform { index, info, .. } => {
//                 let mut write = WriteDescriptorSet::default()
//                     .dst_set(self.set)
//                     .dst_binding(*index)
//                     .descriptor_count(1)
//                     .descriptor_type(DescriptorType::UNIFORM_BUFFER_DYNAMIC);
//                 write.p_buffer_info = info;
//                 write.descriptor_count = 1;
//                 write
//             }
//             BoundResource::Buffer { index, info, .. } => {
//                 let mut write = WriteDescriptorSet::default()
//                     .dst_set(self.set)
//                     .dst_binding(*index)
//                     .descriptor_count(1)
//                     .descriptor_type(DescriptorType::UNIFORM_BUFFER);
//                 write.p_buffer_info = info;
//                 write.descriptor_count = 1;
//                 write
//             }
//             BoundResource::Texture { index, info, .. } => {
//                 let mut write = WriteDescriptorSet::default()
//                     .dst_set(self.set)
//                     .dst_binding(*index)
//                     .descriptor_count(1)
//                     .descriptor_type(DescriptorType::COMBINED_IMAGE_SAMPLER);
//                 write.p_image_info = info;
//                 write.descriptor_count = 1;
//                 write
//             }
//         }
//     }

//     pub fn bind(&self, ctx: &RenderContext) -> Result<()> {
//         let mut buffer_writes = vec![];
//         let mut image_writes = vec![];
//         let mut image_infos = vec![];
//         let mut buffer_infos = vec![];

//         for binding in &self.bindings {
//             match binding {
//                 BoundResource::DynamicUniform {
//                     index,
//                     buffer,
//                     size,
//                     offset,
//                     range,
//                     info,
//                 } => {
//                     buffer_infos.push([DescriptorBufferInfo::default()
//                         .buffer(buffer.handle())
//                         .offset(*offset)
//                         .range(*range)]);
//                     buffer_writes.push(
//                         WriteDescriptorSet::default()
//                             .dst_set(self.set)
//                             .dst_binding(*index)
//                             .descriptor_count(1)
//                             .descriptor_type(DescriptorType::UNIFORM_BUFFER_DYNAMIC),
//                     );
//                 }
//                 BoundResource::Buffer {
//                     index,
//                     buffer,
//                     size,
//                     offset,
//                     info,
//                 } => {
//                     buffer_infos.push([DescriptorBufferInfo::default()
//                         .buffer(buffer.handle())
//                         .offset(*offset)
//                         .range(*size)]);
//                     buffer_writes.push(
//                         WriteDescriptorSet::default()
//                             .dst_set(self.set)
//                             .dst_binding(*index)
//                             .descriptor_count(1)
//                             .descriptor_type(DescriptorType::UNIFORM_BUFFER),
//                     );
//                 }
//                 BoundResource::Texture {
//                     index,
//                     image,
//                     sampler,
//                     info,
//                 } => {
//                     image_infos.push([DescriptorImageInfo::default()
//                         .image_layout(ImageLayout::SHADER_READ_ONLY_OPTIMAL)
//                         .image_view(image.view())
//                         .sampler(*sampler)]);
//                     image_writes.push(
//                         WriteDescriptorSet::default()
//                             .dst_set(self.set)
//                             .dst_binding(*index)
//                             .descriptor_count(1)
//                             .descriptor_type(DescriptorType::COMBINED_IMAGE_SAMPLER),
//                     );
//                 }
//             }
//         }

//         for i in 0..buffer_infos.len() {
//             buffer_writes[i] = buffer_writes[i].buffer_info(&buffer_infos[i]);
//         }
//         for i in 0..image_infos.len() {
//             image_writes[i] = image_writes[i].image_info(&image_infos[i]);
//         }

//         if !buffer_writes.is_empty() {
//             ctx.cmd_buffer
//                 .update_descriptor_set(buffer_writes.as_slice(), &[])
//         }

//         if !image_writes.is_empty() {
//             ctx.cmd_buffer
//                 .update_descriptor_set(image_writes.as_slice(), &[])
//         }

//         Ok(())
//     }

//     // pub fn update(&self, ctx: &RenderContext) -> Result<&Self> {
//     //     let mut buffer_writes = vec![];
//     //     let mut image_writes = vec![];
//     //     let mut image_infos = vec![];
//     //     let mut buffer_infos = vec![];

//     //     for binding in &self.bindings {
//     //         match binding {
//     //             BoundResource::DynamicUniform {
//     //                 index,
//     //                 buffer,
//     //                 offset,
//     //                 range,
//     //                 ..
//     //             } => {
//     //                 buffer_infos.push([DescriptorBufferInfo::default()
//     //                     .buffer(buffer.handle())
//     //                     .offset(*offset)
//     //                     .range(*range)]);
//     //                 buffer_writes.push(
//     //                     WriteDescriptorSet::default()
//     //                         .dst_set(self.set)
//     //                         .dst_binding(*index)
//     //                         .descriptor_count(1)
//     //                         .descriptor_type(DescriptorType::UNIFORM_BUFFER_DYNAMIC),
//     //                 );
//     //             }
//     //             BoundResource::Buffer {
//     //                 index,
//     //                 buffer,
//     //                 size,
//     //                 offset,
//     //                 info,
//     //             } => {
//     //                 buffer_infos.push([DescriptorBufferInfo::default()
//     //                     .buffer(buffer.handle())
//     //                     .offset(*offset)
//     //                     .range(*size)]);
//     //                 buffer_writes.push(
//     //                     WriteDescriptorSet::default()
//     //                         .dst_set(self.set)
//     //                         .dst_binding(*index)
//     //                         .descriptor_count(1)
//     //                         .descriptor_type(DescriptorType::UNIFORM_BUFFER),
//     //                 );
//     //             }
//     //             BoundResource::Texture {
//     //                 index,
//     //                 image,
//     //                 sampler,
//     //                 info,
//     //             } => {
//     //                 image_infos.push([DescriptorImageInfo::default()
//     //                     .image_layout(ImageLayout::SHADER_READ_ONLY_OPTIMAL)
//     //                     .image_view(image.view())
//     //                     .sampler(*sampler)]);
//     //                 image_writes.push(
//     //                     WriteDescriptorSet::default()
//     //                         .dst_set(self.set)
//     //                         .dst_binding(*index)
//     //                         .descriptor_count(1)
//     //                         .descriptor_type(DescriptorType::COMBINED_IMAGE_SAMPLER),
//     //                 );
//     //             }
//     //         }
//     //     }

//     //     for i in 0..buffer_infos.len() {
//     //         buffer_writes[i] = buffer_writes[i].buffer_info(&buffer_infos[i]);
//     //     }
//     //     for i in 0..image_infos.len() {
//     //         image_writes[i] = image_writes[i].image_info(&image_infos[i]);
//     //     }

//     //     if !buffer_writes.is_empty() {
//     //         ctx.cmd_buffer
//     //             .update_descriptor_set(buffer_writes.as_slice(), &[])
//     //     }

//     //     if !image_writes.is_empty() {
//     //         ctx.cmd_buffer
//     //             .update_descriptor_set(image_writes.as_slice(), &[])
//     //     }

//     //     Ok(self)
//     // }

//     pub fn write_descriptor(&self, index: usize) -> Option<WriteDescriptorSet<'a>> {
//         self.bindings.get(index).map(|b| self.extract2(b))
//     }
// }

// enum WriteThing<'a> {
//     Buffer(WriteDescriptorSet<'a>, DescriptorBufferInfo),
//     Image(WriteDescriptorSet<'a>, DescriptorImageInfo),
// }

// pub enum BoundResource<'a> {
//     DynamicUniform {
//         info: DescriptorBufferInfo,
//         index: u32,
//         buffer: &'a RawBuffer,
//         size: u64,
//         offset: u64,
//         range: u64,
//     },
//     Buffer {
//         info: DescriptorBufferInfo,
//         index: u32,
//         buffer: &'a RawBuffer,
//         size: u64,
//         offset: u64,
//     },
//     Texture {
//         info: DescriptorImageInfo,
//         index: u32,
//         sampler: Sampler,
//         image: &'a AllocatedTexture,
//     },
// }
