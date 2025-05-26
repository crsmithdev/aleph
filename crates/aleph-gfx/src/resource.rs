use {
    aleph_vk::{
        CommandBuffer, DescriptorBindingFlags, DescriptorBufferInfo, DescriptorImageInfo,
        DescriptorPoolCreateFlags, DescriptorPoolSize, DescriptorSet, DescriptorSetLayout,
        DescriptorSetLayoutBinding, DescriptorSetLayoutCreateFlags, DescriptorType, Gpu,
        ImageLayout, PipelineLayout, Sampler, ShaderStageFlags, Texture, TypedBuffer,
        WriteDescriptorSet,
    },
    anyhow::Result,
    bytemuck::Pod,
    derive_more::Debug,
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

        for unbound in &self.resources {
            let binding = DescriptorSetLayoutBinding::default()
                .binding(unbound.index as u32)
                .descriptor_count(unbound.descriptor_count as u32)
                .stage_flags(unbound.stage_flags)
                .descriptor_type(unbound.descriptor_type);

            bindings.push(binding);
            binding_flags.push(unbound.binding_flags);
        }

        let desriptor_layout = gpu.create_descriptor_set_layout(
            &bindings,
            DescriptorSetLayoutCreateFlags::UPDATE_AFTER_BIND_POOL,
            &binding_flags,
        )?;
        log::debug!("Created descriptor layout: {desriptor_layout:?}");

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
        log::debug!("Created descriptor pool: {descriptor_pool:?}",);
        let has_variable_binding = self
            .resources
            .iter()
            .any(|b| b.dimensionality == Dimensionality::Array && b.descriptor_count > 1);
        let variable_descriptors = match has_variable_binding {
            true => Some(
                128.min(gpu.device().properties().limits.max_per_stage_descriptor_sampled_images),
            ),
            false => None,
        };
        log::debug!("Variable descriptors: {variable_descriptors:?}");

        let descriptor_set =
            gpu.create_descriptor_set(desriptor_layout, descriptor_pool, variable_descriptors)?;
        log::debug!("Created descriptor set: {descriptor_set:?}");

        Ok(ResourceBinder {
            set_index: self.set as u32,
            descriptor_set,
            descriptor_layout: desriptor_layout,
            bindings: vec![],
        })
    }
}

#[derive(Debug)]
pub struct ResourceBinder {
    set_index: u32,
    #[debug(skip)]
    bindings: Vec<BoundResource>,
    descriptor_layout: DescriptorSetLayout,
    descriptor_set: DescriptorSet,
}

impl ResourceBinder {
    pub fn descriptor_layout(&self) -> DescriptorSetLayout { self.descriptor_layout }

    pub fn descriptor_set(&self) -> DescriptorSet { self.descriptor_set }

    pub fn storage_buffer<T: Pod>(
        &mut self,
        index: usize,
        buffer: &TypedBuffer<T>,
        count: usize,
        offset: u64,
    ) -> &mut Self {
        self.bindings.push(BoundResource::StorageBuffer {
            count,
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
        images: &Vec<Rc<Texture>>,
        default_sampler: &Sampler,
    ) -> &mut Self {
        let info = images
            .iter()
            .map(|image| {
                DescriptorImageInfo::default()
                    .image_layout(ImageLayout::SHADER_READ_ONLY_OPTIMAL)
                    .image_view(image.view())
                    .sampler(*image.sampler().unwrap_or(default_sampler.clone()))
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
                .sampler(*sampler),
        });
        self
    }

    pub fn update(&self, gpu: &Gpu) -> Result<&Self> {
        let writes = self.bindings.iter().map(|binding| self.extract(binding)).collect::<Vec<_>>();
        if !writes.is_empty() {
            gpu.update_descriptor_sets(&writes.as_slice(), &[])?;
        }

        Ok(self)
    }

    fn extract(&self, binding: &BoundResource) -> WriteDescriptorSet {
        match binding {
            BoundResource::StorageBuffer {
                index, info, count, ..
            } => {
                let mut write = WriteDescriptorSet::default()
                    .dst_set(self.descriptor_set)
                    .dst_binding(*index)
                    .descriptor_count(*count as u32)
                    .descriptor_type(DescriptorType::STORAGE_BUFFER);
                write.p_buffer_info = info;
                write.descriptor_count = 1;
                write
            }
            BoundResource::TextureArray {
                index, info, count, ..
            } => {
                let mut write = WriteDescriptorSet::default()
                    .dst_set(self.descriptor_set)
                    .dst_binding(*index)
                    .descriptor_count(*count as u32)
                    .descriptor_type(DescriptorType::COMBINED_IMAGE_SAMPLER);
                write.p_image_info = info.as_ptr();
                write.descriptor_count = info.len() as u32;
                write
            }
            BoundResource::DynamicUniform { index, info, .. } => {
                let mut write = WriteDescriptorSet::default()
                    .dst_set(self.descriptor_set)
                    .dst_binding(*index)
                    .descriptor_count(1)
                    .descriptor_type(DescriptorType::UNIFORM_BUFFER_DYNAMIC);
                write.p_buffer_info = info;
                write.descriptor_count = 1;
                write
            }
            BoundResource::Buffer { index, info, .. } => {
                let mut write = WriteDescriptorSet::default()
                    .dst_set(self.descriptor_set)
                    .dst_binding(*index)
                    .descriptor_count(1)
                    .descriptor_type(DescriptorType::UNIFORM_BUFFER);
                write.p_buffer_info = info;
                write.descriptor_count = 1;
                write
            }
            BoundResource::Texture { index, info, .. } => {
                let mut write = WriteDescriptorSet::default()
                    .dst_set(self.descriptor_set)
                    .dst_binding(*index)
                    .descriptor_count(1)
                    .descriptor_type(DescriptorType::COMBINED_IMAGE_SAMPLER);
                write.p_image_info = info;
                write.descriptor_count = 1;
                write
            }
        }
    }

    pub fn bind<'a>(&self, cmd: &CommandBuffer, pipeline_layout: PipelineLayout, offsets: &[u32]) {
        cmd.bind_descriptor_sets(
            pipeline_layout,
            self.set_index,
            &[self.descriptor_set],
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
        count: usize,
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
