use {
    crate::{
        renderer::{GpuDrawData, GpuMaterialData},
        Pipeline, PipelineBuilder, RenderContext, ResourceBinder, ResourceLayout,
    },
    aleph_scene::{model::Primitive, util, Material, MaterialHandle, NodeType, Vertex},
    aleph_vk::{
        AttachmentLoadOp, AttachmentStoreOp, Buffer, BufferUsageFlags, ColorComponentFlags,
        CompareOp, CullModeFlags, DescriptorBufferInfo, DescriptorSet, DescriptorType, FrontFace,
        Gpu, PipelineBindPoint, PipelineColorBlendAttachmentState, PipelineLayout, PolygonMode,
        PrimitiveTopology, Rect2D, ShaderStageFlags, Texture, VkPipeline, WriteDescriptorSet,
    },
    anyhow::Result,
    ash::{
        util::Align,
        vk::{DeviceSize, WHOLE_SIZE},
    },
    glam::Mat4,
    std::{collections::HashMap, ffi::c_void, mem},
    tracing::{instrument, warn},
};

const BIND_IDX_SCENE: u32 = 0;
const BIND_IDX_DRAW: u32 = 0;
const BIND_IDX_MATERIAL: u32 = 0;
const BIND_IDX_BASE_COLOR: u32 = 1;
const BIND_IDX_NORMAL: u32 = 2;
const BIND_IDX_METALROUGH: u32 = 3;
const BIND_IDX_AO: u32 = 4;
const CLEAR_COLOR: [f32; 4] = [0.0, 0.0, 0.0, 1.0];

const VERTEX_SHADER_PATH: &str = "shaders/forward.vert.spv";
const FRAGMENT_SHADER_PATH: &str = "shaders/forward.frag.spv";

pub struct ForwardPipeline {
    handle: VkPipeline,
    pipeline_layout: PipelineLayout,
    material_buffer: Buffer<GpuMaterialData>,
    draw_buffer: Buffer<GpuDrawData>,
    draw_descriptors: DescriptorSet,
    material_descriptors: DescriptorSet,
    scene_descriptors: DescriptorSet,
}

impl Pipeline for ForwardPipeline {
    #[instrument(skip_all)]
    fn execute(&mut self, context: &RenderContext) -> Result<()> {
        let cmd = context.cmd_buffer;

        let color_attachments = &[util::color_attachment(
            context.draw_image,
            AttachmentLoadOp::CLEAR,
            AttachmentStoreOp::STORE,
            CLEAR_COLOR,
        )];
        let depth_attachment = &util::depth_attachment(
            context.depth_image,
            AttachmentLoadOp::CLEAR,
            AttachmentStoreOp::STORE,
            1.0,
        );
        let viewport = util::viewport_inverted(context.extent.into());
        cmd.begin_rendering(color_attachments, Some(depth_attachment), context.extent)?;
        cmd.set_viewport(viewport);
        cmd.set_scissor(Rect2D::default().extent(context.extent));

        let batches = Self::get_batches(context);
        let batch = batches.get(&None).unwrap();
        let transforms = batch
            .iter()
            .map(|(_, transform)| *transform)
            .collect::<Vec<_>>();

        self.update_material_buffer(context, &Material::default())?;
        self.update_draw_buffer(context, transforms)?;

        cmd.bind_pipeline(PipelineBindPoint::GRAPHICS, self.handle)?;
        self.bind_scene(context)?;
        self.bind_material(context, &Material::default())?;

        for drawables in batches {
            self.draw(context, drawables.1)?;
        }

        context.cmd_buffer.end_rendering()
    }
}

impl ForwardPipeline {
    pub fn new(gpu: &Gpu) -> Result<Self> {
        let (scene_descriptors, scene_layout) = ResourceLayout::default()
            .uniform(BIND_IDX_SCENE, ShaderStageFlags::ALL_GRAPHICS)
            .create_descriptor_set(gpu)?;

        let (material_descriptors, material_layout) = ResourceLayout::default()
            .uniform(BIND_IDX_MATERIAL, ShaderStageFlags::ALL_GRAPHICS)
            .texture(BIND_IDX_BASE_COLOR, ShaderStageFlags::ALL_GRAPHICS)
            .texture(BIND_IDX_NORMAL, ShaderStageFlags::ALL_GRAPHICS)
            .texture(BIND_IDX_METALROUGH, ShaderStageFlags::ALL_GRAPHICS)
            .texture(BIND_IDX_AO, ShaderStageFlags::ALL_GRAPHICS)
            .create_descriptor_set(gpu)?;

        let (draw_descriptors, draw_layout) = ResourceLayout::default()
            .dynamic_uniform(BIND_IDX_DRAW, ShaderStageFlags::ALL_GRAPHICS)
            .create_descriptor_set(gpu)?;

        let pipeline_layout =
            gpu.create_pipeline_layout(&[scene_layout, material_layout, draw_layout], &[])?;
        let handle = Self::create_pipeline(gpu, pipeline_layout)?;
        let (draw_buffer, material_buffer) = Self::create_buffers(gpu)?;

        Ok(Self {
            handle,
            pipeline_layout,
            material_buffer,
            draw_buffer,
            draw_descriptors,
            material_descriptors,
            scene_descriptors,
        })
    }

    fn draw(&mut self, ctx: &RenderContext, drawables: Vec<(&Primitive, Mat4)>) -> Result<()> {
        for (i, (primitive, _)) in drawables.iter().enumerate() {
            self.draw_primitive(ctx, primitive, i)?;
        }

        Ok(())
    }

    fn draw_primitive(
        &self,
        ctx: &RenderContext,
        primitive: &Primitive,
        offset: usize,
    ) -> Result<()> {
        self.bind_draw(ctx, primitive, offset)?;
        ctx.cmd_buffer
            .bind_index_buffer(primitive.index_buffer.raw(), 0);
        ctx.cmd_buffer
            .bind_vertex_buffer(primitive.vertex_buffer.raw(), 0);
        ctx.cmd_buffer
            .draw_indexed(primitive.vertex_count, 1, 0, 0, 0);

        Ok(())
    }

    fn create_pipeline(gpu: &Gpu, layout: PipelineLayout) -> Result<VkPipeline> {
        let vertex_shader = gpu.create_shader_module(VERTEX_SHADER_PATH)?;
        let fragment_shader = gpu.create_shader_module(FRAGMENT_SHADER_PATH)?;
        let attachments = &[PipelineColorBlendAttachmentState::default()
            .blend_enable(false)
            .color_write_mask(
                ColorComponentFlags::A
                    | ColorComponentFlags::R
                    | ColorComponentFlags::G
                    | ColorComponentFlags::B,
            )];

        PipelineBuilder::default() // TODO verify defaults
            .vertex_attributes(&Vertex::binding_attributes())
            .vertex_shader(vertex_shader)
            .fragment_shader(fragment_shader)
            .blend_disabled(attachments)
            .depth_enabled(CompareOp::LESS_OR_EQUAL)
            .input_topology(PrimitiveTopology::TRIANGLE_LIST)
            .polygon_mode(PolygonMode::FILL)
            .winding(FrontFace::COUNTER_CLOCKWISE, CullModeFlags::BACK)
            .multisampling_disabled()
            .dynamic_scissor()
            .dynamic_viewport()
            .build(gpu, layout)
    }

    fn create_buffers(gpu: &Gpu) -> Result<(Buffer<GpuDrawData>, Buffer<GpuMaterialData>)> {
        let draw_buffer = gpu.create_shared_buffer::<GpuDrawData>(
            mem::size_of::<GpuDrawData>() as u64 * 100,
            BufferUsageFlags::TRANSFER_DST | BufferUsageFlags::UNIFORM_BUFFER,
            "forward-draw",
        )?;
        let material_buffer = gpu.create_shared_buffer::<GpuMaterialData>(
            mem::size_of::<GpuMaterialData>() as u64,
            BufferUsageFlags::TRANSFER_DST | BufferUsageFlags::UNIFORM_BUFFER,
            "forward-material",
        )?;
        Ok((draw_buffer, material_buffer))
    }

    fn update_draw_buffer(&mut self, context: &RenderContext, transforms: Vec<Mat4>) -> Result<()> {
        let data = transforms
            .into_iter()
            .map(|t| GpuDrawData { model: t })
            .collect::<Vec<_>>();
        self.draw_buffer.write(&data);

        // let offset = i as u64 * mem::size_of::<GpuDrawData>() as DeviceSize;
        // let range = mem::size_of::<GpuDrawData>() as DeviceSize;

        let info = &[DescriptorBufferInfo::default()
            .buffer(self.draw_buffer.handle())
            .offset(0)
            .range(WHOLE_SIZE)];
        let write = WriteDescriptorSet::default()
            .dst_set(self.draw_descriptors)
            .dst_binding(0)
            .descriptor_count(1)
            .descriptor_type(DescriptorType::UNIFORM_BUFFER_DYNAMIC)
            .buffer_info(info);

        context.cmd_buffer.update_descriptor_set(&[write], &[]);
        Ok(())
    }

    fn update_material_buffer(&mut self, ctx: &RenderContext, material: &Material) -> Result<()> {
        let data = GpuMaterialData {
            color_factor: material.color_factor,
            metallic_factor: material.metallic_factor,
            roughness_factor: material.roughness_factor,
            ao_strength: material.ao_strength,
            padding0: 0.,
        };

        self.material_buffer.write(&[data]);

        let base_texture = material
            .color_texture
            .and_then(|handle| ctx.assets.texture(handle))
            .unwrap_or_else(|| ctx.assets.defaults.white_srgb.clone());
        let base_sampler = base_texture
            .sampler()
            .unwrap_or(ctx.assets.defaults.sampler);

        let normal_texture = material
            .normal_texture
            .and_then(|handle| ctx.assets.texture(handle))
            .unwrap_or_else(|| ctx.assets.defaults.normal.clone());
        let normal_sampler = normal_texture
            .sampler()
            .or(Some(ctx.assets.defaults.sampler))
            .unwrap();

        let metalrough_texture = material
            .metalrough_texture
            .and_then(|handle| ctx.assets.texture(handle))
            .unwrap_or_else(|| ctx.assets.defaults.white_linear.clone());
        let metalrough_sampler = metalrough_texture
            .sampler()
            .unwrap_or(ctx.assets.defaults.sampler);

        let ao_texture = material
            .ao_texture
            .and_then(|handle| ctx.assets.texture(handle))
            .unwrap_or_else(|| ctx.assets.defaults.white_linear.clone());
        let ao_sampler = ao_texture.sampler().unwrap_or(ctx.assets.defaults.sampler);

        let ao_texture = ctx.assets.defaults.white_linear.clone();
        let ao_sampler = ctx.assets.defaults.sampler;
        let color_texture = ctx.assets.defaults.white_srgb.clone();
        let color_sampler = ctx.assets.defaults.sampler;
        let normal_texture = ctx.assets.defaults.normal.clone();
        let normal_sampler = ctx.assets.defaults.sampler;
        let metalrough_texture = ctx.assets.defaults.white_linear.clone();
        let metalrough_sampler = ctx.assets.defaults.sampler;

        ResourceBinder::set(self.material_descriptors)
            .uniform(BIND_IDX_MATERIAL, &self.material_buffer)
            .texture(BIND_IDX_BASE_COLOR, &color_texture, color_sampler)
            .texture(BIND_IDX_NORMAL, &normal_texture, normal_sampler)
            .texture(BIND_IDX_METALROUGH, &metalrough_texture, metalrough_sampler)
            .texture(BIND_IDX_AO, &ao_texture, ao_sampler)
            .update(ctx)
    }

    pub fn bind_draw(
        &self,
        ctx: &RenderContext,
        primitive: &Primitive,
        offset: usize,
    ) -> Result<()> {
        ctx.cmd_buffer
            .bind_index_buffer(primitive.index_buffer.raw(), 0);
        ctx.cmd_buffer
            .bind_vertex_buffer(primitive.vertex_buffer.raw(), 0);

        let offsets = [offset as u32 * mem::size_of::<GpuDrawData>() as u32];
        ctx.cmd_buffer.bind_descriptor_sets(
            self.pipeline_layout,
            2,
            &[self.draw_descriptors],
            &offsets,
        );

        Ok(())
    }

    pub fn bind_material(&self, ctx: &RenderContext, material: &Material) -> Result<()> {
        ctx.cmd_buffer.bind_descriptor_sets(
            self.pipeline_layout,
            1,
            &[self.material_descriptors],
            &[],
        );

        Ok(())
    }

    pub fn bind_scene(&self, ctx: &RenderContext) -> Result<()> {
        ResourceBinder::set(self.scene_descriptors)
            .uniform(BIND_IDX_SCENE, &ctx.scene_buffer)
            .update(ctx)?;
        ctx.cmd_buffer.bind_descriptor_sets(
            self.pipeline_layout,
            0,
            &[self.scene_descriptors],
            &[],
        );
        Ok(())
    }

    fn get_batches<'a>(
        ctx: &'a RenderContext<'_>,
    ) -> HashMap<Option<aleph_scene::assets::AssetHandle<Material>>, Vec<(&'a Primitive, Mat4)>>
    {
        let mut material_batches: HashMap<Option<MaterialHandle>, Vec<(&Primitive, Mat4)>> =
            HashMap::new();

        for node in ctx.scene.mesh_nodes() {
            match node.data {
                NodeType::Mesh(handle) => {
                    let mesh = ctx.assets.mesh(handle).unwrap();
                    let transform = node.transform;
                    for primitive in mesh.primitives.iter() {
                        material_batches
                            .entry(None)
                            .or_default()
                            .push((primitive, transform))
                    }
                }
                _ => {}
            }
        }
        material_batches
    }
}

pub unsafe fn mem_copy_aligned<T: Copy>(ptr: *mut c_void, alignment: DeviceSize, data: &[T]) {
    let size = data.len() as DeviceSize * alignment;
    let mut align = Align::new(ptr, alignment, size);
    align.copy_from_slice(data);
}
