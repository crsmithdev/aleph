use {
    crate::RenderContext,
    aleph_vk::{
        AllocatedTexture, Buffer, DescriptorBufferInfo, DescriptorImageInfo,
        DescriptorPoolCreateFlags, DescriptorPoolSize, DescriptorSet, DescriptorSetLayout,
        DescriptorSetLayoutBinding, DescriptorSetLayoutCreateFlags, DescriptorType, Gpu,
        ImageLayout, PipelineLayout, RawBuffer, Sampler, ShaderStageFlags, Texture,
        WriteDescriptorSet,
    },
    anyhow::Result,
    bytemuck::Pod,
    std::collections::HashMap,
};
pub struct UnboundResource {
    index: usize,
    flags: ShaderStageFlags,
    descriptor_type: DescriptorType,
}
pub enum BoundResource<'a> {
    DynamicUniform {
        index: u32,
        buffer: &'a RawBuffer,
        size: u64,
        offset: u64,
        range: u64,
    },
    Buffer {
        index: u32,
        buffer: &'a RawBuffer,
        size: u64,
        offset: u64,
    },
    Texture {
        index: u32,
        sampler: Sampler,
        image: &'a AllocatedTexture,
    },
}

impl<'a> BoundResource<'a> {
    fn write_descriptor(&self, set: &DescriptorSet) -> *const u8 {
        match self {
            BoundResource::DynamicUniform {
                buffer,
                offset,
                index,
                range,
                ..
            } => {
                let info = [DescriptorBufferInfo::default()
                    .buffer(buffer.handle())
                    .offset(*offset)
                    .range(*range)];
                let write = WriteDescriptorSet::default()
                    .dst_set(*set)
                    .dst_binding(*index)
                    .descriptor_count(1)
                    .buffer_info(&info)
                    .descriptor_type(DescriptorType::UNIFORM_BUFFER);

                std::ptr::addr_of!(write) as *const u8
            }
            BoundResource::Buffer {
                index,
                buffer,
                size,
                offset,
            } => {
                let info = [DescriptorBufferInfo::default()
                    .buffer(buffer.handle())
                    .offset(*offset)
                    .range(*size)];
                let write = WriteDescriptorSet::default()
                    .dst_set(*set)
                    .dst_binding(*index)
                    .descriptor_count(1)
                    .buffer_info(&info)
                    .descriptor_type(DescriptorType::UNIFORM_BUFFER);

                std::ptr::addr_of!(write) as *const u8
            }
            BoundResource::Texture {
                image,
                index,
                sampler,
            } => {
                let info = [DescriptorImageInfo::default()
                    .image_layout(ImageLayout::SHADER_READ_ONLY_OPTIMAL)
                    .image_view(image.view())
                    .sampler(*sampler)];
                let write = WriteDescriptorSet::default()
                    .dst_set(*set)
                    .dst_binding(*index)
                    .descriptor_count(1)
                    .descriptor_type(DescriptorType::UNIFORM_BUFFER)
                    .image_info(&info);

                std::ptr::addr_of!(write) as *const u8
            }
        }
    }
}

#[derive(Default)]
pub struct ResourceBuilder {
    unbound: HashMap<usize, UnboundResource>,
}

impl ResourceBuilder {
    const N_DESCRIPTORS: u32 = 10000;
    fn uniform_buffer(&mut self, index: usize, flags: ShaderStageFlags) -> &mut Self {
        self.add(index, flags, DescriptorType::UNIFORM_BUFFER)
    }
    fn dynamic_buffer(&mut self, index: usize, flags: ShaderStageFlags) -> &mut Self {
        self.add(index, flags, DescriptorType::UNIFORM_BUFFER_DYNAMIC)
    }
    fn texture(&mut self, index: usize, flags: ShaderStageFlags) -> &mut Self {
        self.add(index, flags, DescriptorType::COMBINED_IMAGE_SAMPLER)
    }

    fn add(
        &mut self,
        index: usize,
        flags: ShaderStageFlags,
        descriptor_type: DescriptorType,
    ) -> &mut Self {
        self.unbound.insert(
            index,
            UnboundResource {
                index,
                flags,
                descriptor_type,
            },
        );
        self
    }

    fn define(self, gpu: &Gpu) -> Result<Resources> {
        let layout_bindings: Vec<DescriptorSetLayoutBinding> = self
            .unbound
            .iter()
            .map(|(index, binding)| {
                DescriptorSetLayoutBinding::default()
                    .binding(*index as u32)
                    .descriptor_count(1)
                    .stage_flags(binding.flags)
                    .descriptor_type(binding.descriptor_type)
            })
            .collect();
        let descriptor_layout = gpu.create_descriptor_set_layout(
            &layout_bindings,
            DescriptorSetLayoutCreateFlags::UPDATE_AFTER_BIND_POOL,
        )?;

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

        let descriptor_set = gpu.create_descriptor_set(descriptor_layout, descriptor_pool)?;

        Ok(Resources {
            descriptor_set,
            descriptor_layout,
            unbound: self.unbound,
            bound: HashMap::new(),
        })
    }
}

#[derive(Default)]
pub struct Resources<'a> {
    descriptor_set: DescriptorSet,
    descriptor_layout: DescriptorSetLayout,
    unbound: HashMap<usize, UnboundResource>,
    bound: HashMap<usize, BoundResource<'a>>,
}

impl<'a> Resources<'a> {
    pub fn descriptor_set(&self) -> DescriptorSet { self.descriptor_set }
    pub fn descriptor_layout(&self) -> DescriptorSetLayout { self.descriptor_layout }

    pub fn uniform_buffer<T: Pod>(&'a mut self, index: usize, buffer: &'a Buffer<T>) {
        self.bind_resource(
            index,
            DescriptorType::UNIFORM_BUFFER,
            BoundResource::Buffer {
                index: index as u32,
                buffer: buffer.raw(),
                size: buffer.size(),
                offset: 0,
            },
        )
    }

    pub fn dynamic_uniform_buffer<T: Pod>(
        &'a mut self,
        index: usize,
        buffer: &'a Buffer<T>,
        offset: u64,
        range: u64,
    ) {
        self.bind_resource(
            index,
            DescriptorType::UNIFORM_BUFFER_DYNAMIC,
            BoundResource::DynamicUniform {
                index: index as u32,
                buffer: buffer.raw(),
                size: buffer.size(),
                offset,
                range,
            },
        )
    }

    pub fn texture(&'a mut self, index: usize, texture: &'a AllocatedTexture) {
        self.bind_resource(
            index,
            DescriptorType::UNIFORM_BUFFER,
            BoundResource::Texture {
                index: index as u32,
                image: texture,
                sampler: texture.sampler().unwrap_or(Sampler::null()),
            },
        )
    }

    fn bind_resource(
        &'a mut self,
        index: usize,
        descriptor_type: DescriptorType,
        resource: BoundResource<'a>,
    ) {
        match self.unbound.remove(&index) {
            Some(unbound) if unbound.descriptor_type == descriptor_type => {
                self.bound.insert(index, resource);
            }
            Some(unbound) => {
                log::warn!(
                    "Resource type mismatch for index {}: expected {:?}, got {:?}",
                    index,
                    unbound.descriptor_type,
                    descriptor_type
                );
            }
            None => {
                log::warn!(
                    "Resource type {:?} has not been defined at index {}",
                    descriptor_type,
                    index
                );
            }
        }
    }

    fn update(&self, ctx: &mut RenderContext) {
        let write_descriptors = self
            .bound
            .values()
            .map(|binding| binding.write_descriptor(&self.descriptor_set))
            .map(|ptr| unsafe { *(ptr as *const WriteDescriptorSet) })
            .collect::<Vec<_>>();

        if !write_descriptors.is_empty() {
            ctx.cmd_buffer
                .update_descriptor_set(write_descriptors.as_slice(), &[]);
        }
    }

    fn bind(&self, ctx: &mut RenderContext, layout: &PipelineLayout) {
        let write_descriptors = self
            .bound
            .values()
            .map(|binding| binding.write_descriptor(&self.descriptor_set))
            .map(|ptr| unsafe { *(ptr as *const WriteDescriptorSet) })
            .collect::<Vec<_>>();

        if !write_descriptors.is_empty() {
            ctx.cmd_buffer
                .bind_descriptor_sets(*layout, 0, &[self.descriptor_set], &[]);
        }
    }

    pub fn write_descriptor(&self, index: usize) -> Option<WriteDescriptorSet> {
        self.bound.get(&index).map(|resource| unsafe {
            *(resource.write_descriptor(&self.descriptor_set) as *const WriteDescriptorSet)
        })
    }
}
