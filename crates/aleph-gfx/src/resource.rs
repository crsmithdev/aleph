use {
    aleph_scene::{
        assets::{BindlessData, GpuMaterial},
        graph::NodeData,
        model::Light,
        Assets, MeshHandle, Scene, Vertex,
    },
    aleph_vk::{
        CommandBuffer, DescriptorBindingFlags, DescriptorBufferInfo, DescriptorImageInfo,
        DescriptorPoolCreateFlags, DescriptorPoolSize, DescriptorSet, DescriptorSetLayout,
        DescriptorSetLayoutBinding, DescriptorSetLayoutCreateFlags, DescriptorType, Fence, Gpu,
        ImageLayout, PipelineLayout, Sampler, ShaderStageFlags, Texture, TypedBuffer,
        WriteDescriptorSet,
    },
    anyhow::Result,
    ash::vk::FenceCreateFlags,
    bytemuck::{Pod, Zeroable},
    derive_more::Debug,
    glam::{Mat4, Vec2, Vec3, Vec4},
    std::{rc::Rc, sync::Arc},
};

const SET_IDX_BINDLESS: usize = 0;
const BIND_IDX_CONFIG: usize = 0;
const BIND_IDX_SCENE: usize = 1;
const BIND_IDX_MATERIAL: usize = 2;
const BIND_IDX_TEXTURE: usize = 3;
const N_LIGHTS: usize = 3;

#[derive(Debug)]
pub struct RendererResources {
    pub scene_buffer: TypedBuffer<GpuSceneData>,
    pub scene_data: GpuSceneData,
    pub config_buffer: TypedBuffer<GpuConfigData>,
    pub config_data: GpuConfigData,
    pub object_data_buffer: TypedBuffer<GpuObjectData>,
    pub index_buffer: TypedBuffer<u32>,
    pub vertex_buffer: TypedBuffer<Vertex>,
    pub render_objects: Vec<RenderObject>,
    pub fence: Fence,
    pub binder: ResourceBinder,
}

impl RendererResources {
    pub fn new(gpu: &Arc<Gpu>) -> Result<Self> {
        let scene_buffer = TypedBuffer::shared_uniform(gpu, 1, "renderer-scene")?;
        let scene_data = GpuSceneData::default();
        let config_buffer = TypedBuffer::shared_uniform(gpu, 1, "renderer-config")?;
        let object_data_buffer = TypedBuffer::shared_uniform(gpu, 1, "renderer-object")?;
        let index_buffer = TypedBuffer::index(gpu, 1, "renderer-index")?;
        let vertex_buffer = TypedBuffer::vertex(gpu, 1, "renderer-vertex")?;
        let config_data = GpuConfigData::default();
        let fence = gpu.device().create_fence(FenceCreateFlags::default());
        let render_objects = vec![];

        // Create resource binder
        let binder = ResourceLayout::set(SET_IDX_BINDLESS)
            .uniform_buffer(BIND_IDX_CONFIG, ShaderStageFlags::ALL_GRAPHICS)
            .uniform_buffer(BIND_IDX_SCENE, ShaderStageFlags::ALL_GRAPHICS)
            .uniform_buffer(BIND_IDX_MATERIAL, ShaderStageFlags::ALL_GRAPHICS)
            .texture_array(BIND_IDX_TEXTURE, ShaderStageFlags::ALL_GRAPHICS)
            .finish(gpu)?;

        Ok(Self {
            scene_buffer,
            scene_data,
            config_buffer,
            object_data_buffer,
            config_data,
            index_buffer,
            vertex_buffer,
            render_objects,
            binder,
            fence,
        })
    }

    pub fn update_per_frame_data(&mut self, scene: &Scene, _assets: &Assets) {
        let cameras = scene.cameras().take(1).collect::<Vec<_>>();
        let camera = cameras[0];
        let view = camera.view().transpose();
        let projection = camera.projection().transpose();

        let lights = scene.lights().take(N_LIGHTS).collect::<Vec<_>>();
        for i in 0..N_LIGHTS.min(lights.len()) {
            self.scene_data.lights[i] = *lights[i];
        }

        self.scene_data.view = view;
        self.scene_data.projection = projection;
        self.scene_data.vp = projection * view.inverse();
        self.scene_data.camera_pos = camera.position();
        self.scene_data.n_lights = N_LIGHTS as u32;

        self.scene_buffer.write(&[self.scene_data]);
        self.config_buffer.write(&[self.config_data]);
    }

    // TODO handle 0 mesh case
    pub fn prepare_bindless(
        &mut self,
        gpu: &Gpu,
        assets: &mut Assets,
        scene: &Scene,
    ) -> Result<()> {
        let cmd = &gpu.immediate_cmd_buffer();
        cmd.begin();

        let bindless_data = assets.prepare_bindless(cmd)?;

        // Prepare materials
        let mut materials_arr = [GpuMaterial::default(); 32];
        for (i, material) in bindless_data.materials.iter().enumerate() {
            materials_arr[i] = *material;
        }
        let object_data = GpuObjectData {
            materials: materials_arr,
        };

        // Create render objects
        let mesh_nodes = scene
            .mesh_nodes()
            .map(|node| match node.data {
                NodeData::Mesh(handle) => (handle, node.world_transform),
                _ => panic!("Should not be here, node: {:?}", node),
            })
            .collect::<Vec<_>>();

        let (render_objects, vertex_buffer, index_buffer) =
            self.create_render_objects2(&gpu, &mesh_nodes, &bindless_data)?;

        self.render_objects = render_objects;
        self.index_buffer = index_buffer;
        self.vertex_buffer = vertex_buffer;
        self.object_data_buffer.write(&[object_data]);

        // Update bindings
        self.binder
            .uniform_buffer(BIND_IDX_CONFIG, &self.config_buffer, 0)
            .uniform_buffer(BIND_IDX_SCENE, &self.scene_buffer, 0)
            .uniform_buffer(BIND_IDX_MATERIAL, &self.object_data_buffer, 0)
            .texture_array(
                BIND_IDX_TEXTURE,
                &bindless_data.textures,
                &assets.default_sampler(),
            )
            .update(&gpu)?;

        cmd.end();
        gpu.queue_submit(&gpu.device().graphics_queue(), &[cmd], &[], &[], self.fence);
        gpu.device().wait_for_fences(&[self.fence]);
        gpu.device().reset_fences(&[self.fence]);

        // gpu.device().wait_idle();
        Ok(())
    }

    fn create_render_objects2(
        &self,
        gpu: &Gpu,
        meshes: &Vec<(MeshHandle, Mat4)>,
        data: &BindlessData,
    ) -> Result<(Vec<RenderObject>, TypedBuffer<Vertex>, TypedBuffer<u32>)> {
        let mut objects = vec![];
        let mut all_vertices = vec![];
        let mut all_indices = vec![];

        for (handle, transform) in meshes.iter() {
            let index = data.mesh_map.get(handle).unwrap();
            let mesh = data.meshes.get(*index).unwrap();

            let vertex_offset = all_vertices.len();
            let index_offset = all_indices.len();
            let index_count = mesh.indices.len();

            // Create vertices
            let mesh_vertices = (0..mesh.vertices.len())
                .map(|i| Vertex {
                    position: mesh.vertices[i],
                    normal: *mesh.normals.get(i).unwrap_or(&Vec3::ONE),
                    tangent: *mesh.tangents.get(i).unwrap_or(&Vec4::ZERO),
                    color: *mesh.colors.get(i).unwrap_or(&Vec4::ONE),
                    uv_x: mesh.tex_coords0.get(i).unwrap_or(&Vec2::ZERO)[0],
                    uv_y: mesh.tex_coords0.get(i).unwrap_or(&Vec2::ZERO)[1],
                })
                .collect::<Vec<_>>();

            // Create indices with vertex offset
            let mesh_indices =
                mesh.indices.iter().map(|&idx| idx + vertex_offset as u32).collect::<Vec<_>>();

            all_vertices.extend(mesh_vertices);
            all_indices.extend(mesh_indices);

            let material = *data.material_map.get(&mesh.material).unwrap_or(&0);

            objects.push(RenderObject {
                vertex_offset,
                index_offset,
                index_count,
                transform: *transform,
                material,
            });
        }

        // Create and populate buffers
        let vertex_buffer = TypedBuffer::vertex(&gpu, all_vertices.len(), "shared_vertices")?;
        let index_buffer = TypedBuffer::index(&gpu, all_indices.len(), "shared_indices")?;

        vertex_buffer.write(bytemuck::cast_slice(&all_vertices));
        index_buffer.write(bytemuck::cast_slice(&all_indices));

        Ok((objects, vertex_buffer, index_buffer))
    }
}
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

    pub fn storage_buffer(
        &mut self,
        index: usize,
        flags: ShaderStageFlags,
        count: usize,
    ) -> &mut Self {
        self.add_binding(UnboundResource {
            index,
            stage_flags: flags,
            descriptor_count: count,
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

        let desriptor_layout = gpu.device().create_descriptor_set_layout(
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

        let descriptor_pool = gpu.device().create_descriptor_pool(
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

        let descriptor_set = gpu.device().create_descriptor_set(
            desriptor_layout,
            descriptor_pool,
            variable_descriptors,
        )?;
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
            gpu.device().update_descriptor_sets(&writes.as_slice(), &[])?;
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

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuSceneData {
    pub view: Mat4,
    pub projection: Mat4,
    pub vp: Mat4,
    pub camera_pos: Vec3,
    pub n_lights: u32,
    pub lights: [Light; N_LIGHTS],
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuConfigData {
    pub flags: u32,
    pub override_metallic: f32,
    pub override_roughness: f32,
    pub override_occlusion: f32,
    pub override_color: Vec4,
    pub override_light0: Vec4,
    pub override_light1: Vec4,
    pub override_light2: Vec4,
    pub override_light3: Vec4,
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuObjectData {
    pub materials: [GpuMaterial; 32],
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuPushConstantData {
    pub model: Mat4,
    pub material_index: u32,
    pub _padding0: u32,
    pub _padding1: u32,
    pub _padding2: u32,
}

// Render Objects
#[derive(Debug)]
pub struct RenderObject {
    pub vertex_offset: usize,
    pub index_offset: usize,
    pub index_count: usize,
    pub material: usize,
    pub transform: Mat4,
}
