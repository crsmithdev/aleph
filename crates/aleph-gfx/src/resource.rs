use {
    crate::RenderContext,
    aleph_vk::{
        Buffer, DescriptorBindingFlags, DescriptorBufferInfo, DescriptorImageInfo,
        DescriptorPoolCreateFlags, DescriptorPoolSize, DescriptorSet, DescriptorSetLayout,
        DescriptorSetLayoutBinding, DescriptorSetLayoutCreateFlags, DescriptorType, Gpu,
        ImageLayout, PipelineLayout, Sampler, ShaderStageFlags, Texture, TypedBuffer,
        WriteDescriptorSet,
    },
    anyhow::Result,
    bytemuck::Pod,
    std::rc::Rc,
};

pub struct ResourceLayout {
    resources: Vec<UnboundResource>,
    set: usize,
}

impl ResourceLayout {
    const N_DESCRIPTORS: u32 = 10000;
    const N_VARIABLE_DESCRIPTORS: usize = 128;

    pub fn set(set: usize) -> Self {
        Self {
            resources: Vec::new(),
            set,
        }
    }

    pub fn storage_buffer(&mut self, index: usize, flags: ShaderStageFlags) -> &mut Self {
        self.add_binding(UnboundResource {
            index,
            stage_flags: flags,
            descriptor_count: 1,
            dimensionality: Dimensionality::Single,
            descriptor_type: DescriptorType::STORAGE_BUFFER,
            binding_flags: DescriptorBindingFlags::default(),
        })
    }

    pub fn texture_array(&mut self, index: usize, flags: ShaderStageFlags) -> &mut Self {
        self.add_binding(UnboundResource {
            index,
            stage_flags: flags,
            descriptor_count: Self::N_VARIABLE_DESCRIPTORS,
            dimensionality: Dimensionality::Array,
            descriptor_type: DescriptorType::COMBINED_IMAGE_SAMPLER,
            binding_flags: DescriptorBindingFlags::default()
                | DescriptorBindingFlags::PARTIALLY_BOUND
                | DescriptorBindingFlags::UPDATE_AFTER_BIND
                | DescriptorBindingFlags::UPDATE_UNUSED_WHILE_PENDING
                | DescriptorBindingFlags::VARIABLE_DESCRIPTOR_COUNT,
        })
    }

    pub fn dynamic_uniform(&mut self, index: usize, stage_flags: ShaderStageFlags) -> &mut Self {
        self.add_binding(UnboundResource {
            index,
            stage_flags,
            descriptor_count: 1,
            dimensionality: Dimensionality::Array,
            descriptor_type: DescriptorType::UNIFORM_BUFFER_DYNAMIC,
            binding_flags: DescriptorBindingFlags::default(),
        })
    }

    pub fn uniform_buffer(&mut self, index: usize, flags: ShaderStageFlags) -> &mut Self {
        self.add_binding(UnboundResource {
            index,
            stage_flags: flags,
            descriptor_count: 1,
            dimensionality: Dimensionality::Single,
            descriptor_type: DescriptorType::UNIFORM_BUFFER,
            binding_flags: DescriptorBindingFlags::default(),
        })
    }

    pub fn texture(&mut self, index: usize, flags: ShaderStageFlags) -> &mut Self {
        self.add_binding(UnboundResource {
            index,
            stage_flags: flags,
            descriptor_count: 1,
            dimensionality: Dimensionality::Single,
            descriptor_type: DescriptorType::COMBINED_IMAGE_SAMPLER,
            binding_flags: DescriptorBindingFlags::default(),
        })
    }

    fn add_binding(&mut self, binding: UnboundResource) -> &mut Self {
        self.resources.push(binding);
        self
    }

    pub fn finish(&mut self, gpu: &Gpu) -> Result<ResourceBinder> {
        let mut bindings = vec![];
        let mut binding_flags = vec![];

        log::debug!("Building descriptor set {:02}:", self.set);

        for unbound in &self.resources {
            let binding = DescriptorSetLayoutBinding::default()
                .binding(unbound.index as u32)
                .descriptor_count(unbound.descriptor_count as u32)
                .stage_flags(unbound.stage_flags)
                .descriptor_type(unbound.descriptor_type);

            log::debug!("  unbound {:02}: {:?}", unbound.index, unbound);
            log::debug!("   -> binding {:?}", binding);
            log::debug!("   -> binding flags: {:?}", unbound.binding_flags);

            bindings.push(binding);
            binding_flags.push(unbound.binding_flags);
        }

        let descriptor_layout = gpu.create_descriptor_set_layout(
            &bindings,
            DescriptorSetLayoutCreateFlags::UPDATE_AFTER_BIND_POOL,
            &binding_flags,
        )?;
        log::debug!(" -> descriptor layout: {:?}", descriptor_layout);

        let pool_sizes = [
            DescriptorPoolSize::default()
                .descriptor_count(Self::N_DESCRIPTORS)
                .ty(DescriptorType::UNIFORM_BUFFER),
            DescriptorPoolSize::default()
                .descriptor_count(Self::N_DESCRIPTORS)
                .ty(DescriptorType::UNIFORM_BUFFER_DYNAMIC),
            DescriptorPoolSize::default()
                .descriptor_count(Self::N_DESCRIPTORS)
                .ty(DescriptorType::COMBINED_IMAGE_SAMPLER),
        ];

        let descriptor_pool = gpu.create_descriptor_pool(
            &pool_sizes,
            DescriptorPoolCreateFlags::UPDATE_AFTER_BIND,
            1,
        )?;
        log::debug!(" -> descriptor pool: {:?}", descriptor_pool);
        let has_variable_binding = self
            .resources
            .iter()
            .any(|b| b.dimensionality == Dimensionality::Array && b.descriptor_count > 1);
        let variable_descriptor_count = match has_variable_binding {
            true => Some(
                128.min(
                    gpu.properties()
                        .limits
                        .max_per_stage_descriptor_sampled_images,
                ),
            ),
            false => None,
        };
        log::debug!(
            " -> # variable descriptors: {:?}",
            variable_descriptor_count
        );

        // let descriptor_counts = self
        // .resources
        // .iter()
        // .map(|binding| binding.descriptor_count as u32)
        // .collect::<Vec<_>>();
        let descriptor_set = gpu.create_descriptor_set(
            descriptor_layout,
            descriptor_pool,
            variable_descriptor_count,
        )?;
        log::debug!(" -> descriptor set: {:?}", descriptor_set);

        Ok(ResourceBinder {
            set_index: self.set as u32,
            set: descriptor_set,
            layout: descriptor_layout,
            bindings: vec![],
        })
    }
}

pub struct ResourceBinder {
    set_index: u32,
    bindings: Vec<BoundResource>,
    layout: DescriptorSetLayout,
    set: DescriptorSet,
}

impl ResourceBinder {
    pub fn descriptor_layout(&self) -> DescriptorSetLayout { self.layout }

    pub fn descriptor_set(&self) -> DescriptorSet { self.set }

    pub fn storage_buffer<T: Pod>(
        &mut self,
        index: usize,
        buffer: &TypedBuffer<T>,
        offset: u64,
    ) -> &mut Self {
        self.bindings.push(BoundResource::StorageBuffer {
            index: index as u32,
            info: DescriptorBufferInfo::default()
                .buffer(buffer.handle())
                .offset(offset)
                .range(buffer.size()),
        });
        self
    }

    pub fn texture_array(
        &mut self,
        index: usize,
        images: &[Rc<Texture>],
        sampler: Sampler,
    ) -> &mut Self {
        let info = images
            .iter()
            .map(|image| {
                DescriptorImageInfo::default()
                    .image_layout(ImageLayout::SHADER_READ_ONLY_OPTIMAL)
                    .image_view(image.view())
                    .sampler(sampler)
            })
            .collect();
        self.bindings.push(BoundResource::TextureArray {
            index: index as u32,
            count: images.len(),
            info: info,
        });
        self
    }
    pub fn uniform_buffer<T: Pod>(
        &mut self,
        index: usize,
        buffer: &TypedBuffer<T>,
        offset: u64,
    ) -> &mut Self {
        self.bindings.push(BoundResource::Buffer {
            index: index as u32,
            info: DescriptorBufferInfo::default()
                .buffer(buffer.handle())
                .offset(offset)
                .range(buffer.size()),
        });
        self
    }

    pub fn dynamic_uniform_buffer<T: Pod>(
        &mut self,
        index: usize,
        buffer: &TypedBuffer<T>,
        offset: u64,
        range: u64,
    ) -> &mut Self {
        self.bindings.push(BoundResource::DynamicUniform {
            index: index as u32,
            info: DescriptorBufferInfo::default()
                .buffer(buffer.handle())
                .offset(offset)
                .range(range),
        });
        self
    }

    pub fn texture(&mut self, index: usize, image: &Texture, sampler: Sampler) -> &mut Self {
        self.bindings.push(BoundResource::Texture {
            index: index as u32,
            info: DescriptorImageInfo::default()
                .image_layout(ImageLayout::SHADER_READ_ONLY_OPTIMAL)
                .image_view(image.view())
                .sampler(sampler),
        });
        self
    }

    pub fn update(&self, gpu: &Gpu) -> Result<&Self> {
        let writes = self
            .bindings
            .iter()
            .map(|binding| self.extract(binding))
            .collect::<Vec<_>>();
        if !writes.is_empty() {
            gpu.execute(|cmd| cmd.update_descriptor_set(&writes.as_slice(), &[]));
        }

        Ok(self)
    }

    fn extract(&self, binding: &BoundResource) -> WriteDescriptorSet {
        match binding {
            BoundResource::StorageBuffer { index, info, .. } => {
                let mut write = WriteDescriptorSet::default()
                    .dst_set(self.set)
                    .dst_binding(*index)
                    .descriptor_count(1)
                    .descriptor_type(DescriptorType::STORAGE_BUFFER);
                write.p_buffer_info = info;
                write.descriptor_count = 1;
                write
            }
            BoundResource::TextureArray {
                index, info, count, ..
            } => {
                let mut write = WriteDescriptorSet::default()
                    .dst_set(self.set)
                    .dst_binding(*index)
                    .descriptor_count(*count as u32)
                    .descriptor_type(DescriptorType::COMBINED_IMAGE_SAMPLER);
                write.p_image_info = info.as_ptr();
                write.descriptor_count = info.len() as u32;
                write
            }
            BoundResource::DynamicUniform { index, info, .. } => {
                let mut write = WriteDescriptorSet::default()
                    .dst_set(self.set)
                    .dst_binding(*index)
                    .descriptor_count(1)
                    .descriptor_type(DescriptorType::UNIFORM_BUFFER_DYNAMIC);
                write.p_buffer_info = info;
                write.descriptor_count = 1;
                write
            }
            BoundResource::Buffer { index, info, .. } => {
                let mut write = WriteDescriptorSet::default()
                    .dst_set(self.set)
                    .dst_binding(*index)
                    .descriptor_count(1)
                    .descriptor_type(DescriptorType::UNIFORM_BUFFER);
                write.p_buffer_info = info;
                write.descriptor_count = 1;
                write
            }
            BoundResource::Texture { index, info, .. } => {
                let mut write = WriteDescriptorSet::default()
                    .dst_set(self.set)
                    .dst_binding(*index)
                    .descriptor_count(1)
                    .descriptor_type(DescriptorType::COMBINED_IMAGE_SAMPLER);
                write.p_image_info = info;
                write.descriptor_count = 1;
                write
            }
        }
    }

    pub fn bind(&self, ctx: &RenderContext, pipeline_layout: PipelineLayout, offsets: &[u32]) {
        ctx.command_buffer.bind_descriptor_sets(
            pipeline_layout,
            self.set_index,
            &[self.set],
            offsets,
        );
    }

    pub fn write_descriptor(&self, index: usize) -> Option<WriteDescriptorSet> {
        self.bindings.get(index).map(|b| self.extract(b))
    }
}

#[derive(Debug)]
pub struct UnboundResource {
    index: usize,
    dimensionality: Dimensionality,
    stage_flags: ShaderStageFlags,
    descriptor_count: usize,
    descriptor_type: DescriptorType,
    binding_flags: DescriptorBindingFlags,
}

#[derive(Debug, PartialEq)]
enum Dimensionality {
    Single,
    Array,
}

pub enum BoundResource {
    StorageBuffer {
        info: DescriptorBufferInfo,
        index: u32,
    },
    DynamicUniform {
        info: DescriptorBufferInfo,
        index: u32,
    },
    Buffer {
        info: DescriptorBufferInfo,
        index: u32,
    },
    Texture {
        info: DescriptorImageInfo,
        index: u32,
    },
    TextureArray {
        count: usize,
        info: Vec<DescriptorImageInfo>,
        index: u32,
    },
}

// #[derive(Default)]
// pub struct ResourceBuilder {
//     unbound: HashMap<usize, UnboundResource>,
// }

// impl ResourceBuilder {
//     const N_DESCRIPTORS: u32 = 10000;
//     pub fn uniform_buffer(&mut self, index: usize, flags: ShaderStageFlags) -> &mut Self {
//         self.add(index, flags, DescriptorType::UNIFORM_BUFFER)
//     }
//     pub fn dynamic_buffer(&mut self, index: usize, flags: ShaderStageFlags) -> &mut Self {
//         self.add(index, flags, DescriptorType::UNIFORM_BUFFER_DYNAMIC)
//     }
//     pub fn texture(&mut self, index: usize, flags: ShaderStageFlags) -> &mut Self {
//         self.add(index, flags, DescriptorType::COMBINED_IMAGE_SAMPLER)
//     }

//     fn add(
//         &mut self,
//         index: usize,
//         flags: ShaderStageFlags,
//         descriptor_type: DescriptorType,
//     ) -> &mut Self {
//         self.unbound.insert(
//             index,
//             UnboundResource {
//                 index,
//                 flags,
//                 descriptor_type,
//             },
//         );
//         self
//     }

//     pub fn define(&mut self, gpu: &Gpu) -> Result<Resources> {
//         let layout_bindings: Vec<DescriptorSetLayoutBinding> = self
//             .unbound
//             .iter()
//             .map(|(index, binding)| {
//                 DescriptorSetLayoutBinding::default()
//                     .binding(*index as u32)
//                     .descriptor_count(1)
//                     .stage_flags(binding.flags)
//                     .descriptor_type(binding.descriptor_type)
//             })
//             .collect();
//         let descriptor_layout = gpu.create_descriptor_set_layout(
//             &layout_bindings,
//             DescriptorSetLayoutCreateFlags::UPDATE_AFTER_BIND_POOL,
//         )?;

//         let pool_sizes = [
//             DescriptorPoolSize::default()
//                 .descriptor_count(Self::N_DESCRIPTORS)
//                 .ty(DescriptorType::UNIFORM_BUFFER),
//             DescriptorPoolSize::default()
//                 .descriptor_count(Self::N_DESCRIPTORS)
//                 .ty(DescriptorType::UNIFORM_BUFFER_DYNAMIC),
//             DescriptorPoolSize::default()
//                 .descriptor_count(Self::N_DESCRIPTORS)
//                 .ty(DescriptorType::COMBINED_IMAGE_SAMPLER),
//         ];
//         let descriptor_pool = gpu.create_descriptor_pool(
//             &pool_sizes,
//             DescriptorPoolCreateFlags::UPDATE_AFTER_BIND,
//             1,
//         )?;

//         let descriptor_set = gpu.create_descriptor_set(descriptor_layout, descriptor_pool)?;

//         Ok(Resources {
//             descriptor_set,
//             descriptor_layout,
//             unbound: self.unbound.clone(),
//             bound: HashMap::new(),
//         })
//     }
// }

// #[derive(Default)]
// pub struct Resources {
//     descriptor_set: DescriptorSet,
//     descriptor_layout: DescriptorSetLayout,
//     unbound: HashMap<usize, UnboundResource>,
//     bound: HashMap<usize, BoundResource>,
// }

// impl Resources {
//     pub fn descriptor_set(&self) -> DescriptorSet { self.descriptor_set }
//     pub fn descriptor_layout(&self) -> DescriptorSetLayout { self.descriptor_layout }

//     pub fn uniform_buffer<T: Pod>(&mut self, index: usize, buffer: &Buffer<T>) -> &mut Self {
//         self.bind_resource(
//             index,
//             DescriptorType::UNIFORM_BUFFER,
//             BoundResource::Buffer {
//                 index: index as u32,
//                 buffer: buffer.handle(),
//                 size: buffer.size(),
//                 offset: 0,
//             },
//         )
//     }

//     pub fn dynamic_uniform_buffer<T: Pod>(
//         &mut self,
//         index: usize,
//         buffer: &Buffer<T>,
//         offset: u64,
//         range: u64,
//     ) -> &mut Self {
//         self.bind_resource(
//             index,
//             DescriptorType::UNIFORM_BUFFER_DYNAMIC,
//             BoundResource::DynamicUniform {
//                 index: index as u32,
//                 buffer: buffer.handle(),
//                 size: buffer.size(),
//                 offset,
//                 range,
//             },
//         )
//     }

//     pub fn texture(
//         &mut self,
//         index: usize,
//         texture: &AllocatedTexture,
//         sampler: Sampler,
//     ) -> &mut Self {
//         self.bind_resource(
//             index,
//             DescriptorType::COMBINED_IMAGE_SAMPLER,
//             BoundResource::Texture {
//                 index: index as u32,
//                 image: texture.view(),
//                 sampler,
//             },
//         )
//     }

//     fn bind_resource(
//         &mut self,
//         index: usize,
//         descriptor_type: DescriptorType,
//         resource: BoundResource,
//     ) -> &mut Self {
//         println!("{} {}", self.unbound.len(), self.bound.len());
//         match self.unbound.remove(&index) {
//             Some(unbound) if unbound.descriptor_type == descriptor_type => {
//                 self.bound.insert(index, resource);
//             }
//             Some(unbound) => {
//                 log::warn!(
//                     "Resource type mismatch for index {}: expected {:?}, got {:?}",
//                     index,
//                     unbound.descriptor_type,
//                     descriptor_type
//                 );
//             }
//             None => {
//                 log::warn!(
//                     "Resource type {:?} has not been defined at index {}",
//                     descriptor_type,
//                     index
//                 );
//             }
//         }

//         self
//     }

//     pub fn update(&self, ctx: &RenderContext) {
//         let mut buffer_writes = vec![];
//         let mut image_writes = vec![];
//         let mut image_infos = vec![];
//         let mut buffer_infos = vec![];

//         for (index, binding) in &self.bound {
//             match binding {
//                 BoundResource::DynamicUniform {
//                     index,
//                     buffer,
//                     size,
//                     offset,
//                     range,
//                 } => {
//                     // let buffer: &RawBuffer = unsafe { &*(*buffer as *const RawBuffer) };
//                     buffer_infos.push([DescriptorBufferInfo::default()
//                         .buffer(*buffer)
//                         .offset(*offset)
//                         .range(*range)]);
//                     buffer_writes.push(
//                         WriteDescriptorSet::default()
//                             // .dst_set(self.set)
//                             .dst_set(self.descriptor_set)
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
//                 } => {
//                     // let buffer: &RawBuffer = unsafe { &*(*buffer as *const RawBuffer) };
//                     buffer_infos.push([DescriptorBufferInfo::default()
//                         .buffer(*buffer)
//                         .offset(*offset)
//                         .range(*size)]);
//                     buffer_writes.push(
//                         WriteDescriptorSet::default()
//                             .dst_set(self.descriptor_set)
//                             .dst_binding(*index)
//                             .descriptor_count(1)
//                             .descriptor_type(DescriptorType::UNIFORM_BUFFER),
//                     );
//                 }
//                 BoundResource::Texture {
//                     index,
//                     image,
//                     sampler,
//                 } => {
//                     // let image: &AllocatedTexture = unsafe { &*(*image as *const AllocatedTexture) };
//                     image_infos.push([DescriptorImageInfo::default()
//                         .image_layout(ImageLayout::SHADER_READ_ONLY_OPTIMAL)
//                         .image_view(*image)
//                         .sampler(*sampler)]);
//                     image_writes.push(
//                         WriteDescriptorSet::default()
//                             .dst_set(self.descriptor_set)
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

//         let mut writes = buffer_writes;
//         writes.extend(image_writes);

//         if !writes.is_empty() {
//             ctx.cmd_buffer.update_descriptor_set(writes.as_slice(), &[])
//         }
//     }

//     pub fn bind(&self, ctx: &RenderContext, layout: &PipelineLayout) {
//         let mut buffer_writes = vec![];
//         let mut image_writes = vec![];
//         let mut image_infos = vec![];
//         let mut buffer_infos = vec![];

//         println!("bound: {:?}", self.bound.len());
//         println!("unbound: {:?}", self.unbound.len());
//         for (index, binding) in &self.bound {
//             match binding {
//                 BoundResource::DynamicUniform {
//                     index,
//                     buffer,
//                     size,
//                     offset,
//                     range,
//                 } => {
//                     // let buffer: &RawBuffer = unsafe { &*(*buffer as *const RawBuffer) };
//                     buffer_infos.push([DescriptorBufferInfo::default()
//                         .buffer(*buffer)
//                         .offset(*offset)
//                         .range(*range)]);
//                     buffer_writes.push(
//                         WriteDescriptorSet::default()
//                             // .dst_set(self.set)
//                             .dst_set(self.descriptor_set)
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
//                 } => {
//                     // let buffer: &RawBuffer = unsafe { &*(*buffer as *const RawBuffer) };
//                     buffer_infos.push([DescriptorBufferInfo::default()
//                         .buffer(*buffer)
//                         .offset(*offset)
//                         .range(*size)]);
//                     buffer_writes.push(
//                         WriteDescriptorSet::default()
//                             // .dst_set(self.set)
//                             .dst_set(self.descriptor_set)
//                             .dst_binding(*index)
//                             .descriptor_count(1)
//                             .descriptor_type(DescriptorType::UNIFORM_BUFFER),
//                     );
//                 }
//                 BoundResource::Texture {
//                     index,
//                     image,
//                     sampler,
//                 } => {
//                     // let image: &AllocatedTexture = unsafe { &*(*image as *const AllocatedTexture) };
//                     image_infos.push([DescriptorImageInfo::default()
//                         .image_layout(ImageLayout::SHADER_READ_ONLY_OPTIMAL)
//                         .image_view(*image)
//                         .sampler(*sampler)]);
//                     image_writes.push(
//                         WriteDescriptorSet::default()
//                             // .dst_set(self.set)
//                             .dst_set(self.descriptor_set)
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

//         let mut writes = buffer_writes;
//         writes.extend(image_writes);

//         if !writes.is_empty() {
//             ctx.cmd_buffer
//                 .bind_descriptor_sets(*layout, 0, &[self.descriptor_set], &[]);
//         }
//     }
// }
