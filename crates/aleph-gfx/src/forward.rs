use {
    crate::{
        GpuDrawData, GpuMaterialData, Pipeline, PipelineBuilder, RenderContext, ResourceBinder,
        ResourceLayout,
    },
    aleph_scene::{graph::NodeHandle, model::Primitive, util, Material, Mesh, NodeData, Vertex},
    aleph_vk::{
        AttachmentLoadOp, AttachmentStoreOp, Buffer, BufferUsageFlags, ColorComponentFlags,
        CompareOp, CullModeFlags, FrontFace, Gpu, PipelineBindPoint,
        PipelineColorBlendAttachmentState, PipelineLayout, PolygonMode, PrimitiveTopology, Rect2D,
        ShaderStageFlags, Texture, VkPipeline,
    },
    anyhow::Result,
    glam::Mat4,
    std::mem,
    tracing::{instrument, warn},
};

const BIND_IDX_SCENE: u32 = 0;
const BIND_IDX_DRAW: u32 = 1;
const BIND_IDX_MATERIAL: u32 = 2;
const BIND_IDX_BASE_COLOR: u32 = 3;
const BIND_IDX_NORMAL: u32 = 4;
const BIND_IDX_METALLIC_ROUGHNESS: u32 = 5;
const BIND_IDX_OCCLUSION: u32 = 6;
const CLEAR_COLOR: [f32; 4] = [0.0, 0.0, 0.0, 1.0];

const VERTEX_SHADER_PATH: &str = "shaders/forward.vert.spv";
const FRAGMENT_SHADER_PATH: &str = "shaders/forward.frag.spv";

pub struct ForwardPipeline {
    handle: VkPipeline,
    layout: PipelineLayout,
    material_buffer: Buffer<GpuMaterialData>,
    draw_buffer: Buffer<GpuDrawData>,
}

impl Pipeline for ForwardPipeline {
    #[instrument(skip_all)]
    fn execute(&self, context: &RenderContext) -> Result<()> {
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
        cmd.bind_pipeline(PipelineBindPoint::GRAPHICS, self.handle)?;

        self.draw_scene(context)?;

        context.cmd_buffer.end_rendering()
    }
}

impl ForwardPipeline {
    pub fn new(gpu: &Gpu) -> Result<Self> {
        let descriptor_layout = ResourceLayout::default()
            .buffer(BIND_IDX_SCENE, ShaderStageFlags::ALL_GRAPHICS)
            .buffer(BIND_IDX_DRAW, ShaderStageFlags::ALL_GRAPHICS)
            .buffer(BIND_IDX_MATERIAL, ShaderStageFlags::FRAGMENT)
            .image(BIND_IDX_BASE_COLOR, ShaderStageFlags::FRAGMENT)
            .image(BIND_IDX_NORMAL, ShaderStageFlags::FRAGMENT)
            .image(BIND_IDX_METALLIC_ROUGHNESS, ShaderStageFlags::FRAGMENT)
            .image(BIND_IDX_OCCLUSION, ShaderStageFlags::FRAGMENT)
            .layout(gpu)?;

        let layout = gpu.create_pipeline_layout(&[descriptor_layout], &[])?;
        let handle = Self::create_pipeline(gpu, layout)?;

        let material_buffer = gpu.create_shared_buffer::<GpuMaterialData>(
            mem::size_of::<GpuMaterialData>() as u64,
            BufferUsageFlags::TRANSFER_DST | BufferUsageFlags::UNIFORM_BUFFER,
            "forward-material",
        )?;
        let draw_buffer = gpu.create_shared_buffer::<GpuDrawData>(
            mem::size_of::<GpuDrawData>() as u64,
            BufferUsageFlags::TRANSFER_DST | BufferUsageFlags::UNIFORM_BUFFER,
            "forward-draw",
        )?;

        Ok(Self {
            handle,
            layout,
            material_buffer,
            draw_buffer,
        })
    }

    fn draw_scene(&self, ctx: &RenderContext) -> Result<()> {
        let world_transform = Mat4::IDENTITY;
        let root = &ctx.scene.root;
        self.draw_node(ctx, *root, world_transform)
    }

    fn draw_node(
        &self,
        ctx: &RenderContext,
        handle: NodeHandle,
        world_transform: Mat4,
    ) -> Result<()> {
        match &ctx.scene.node(handle) {
            None => {
                warn!("Node not found: {:?}", handle);
            } //warn!("TBD"),
            Some(node) => {
                let transform = world_transform * node.transform;
                match &node.data {
                    NodeData::Mesh(mesh_handle) => {
                        let mesh = ctx.assets.mesh(*mesh_handle).unwrap();
                        self.draw_mesh(ctx, mesh, transform)?;
                    }
                    _ => {}
                }

                for child_handle in ctx.scene.children(handle) {
                    self.draw_node(ctx, child_handle, transform)?;
                }
            }
        }

        Ok(())
    }

    fn draw_mesh(&self, context: &RenderContext<'_>, mesh: &Mesh, transform: Mat4) -> Result<()> {
        for primitive in mesh.primitives.iter() {
            let material = match primitive.material {
                Some(idx) => context.assets.material(idx).unwrap(), //&context.scene.materials[&idx],
                None => &Material::default(),
            };
            self.update_draw_buffer(context, transform);
            self.update_material_buffer(material);
            self.bind_resources(context, primitive, material)?;
            context
                .cmd_buffer
                .draw_indexed(primitive.vertex_count, 1, 0, 0, 0);
        }
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

    fn update_draw_buffer(&self, context: &RenderContext, transform: Mat4) {
        let model = transform;
        let view = context.scene.camera.view();

        let data = GpuDrawData {
            model,
            mv: view * model,
            mvp: context.scene.camera.projection() * view * model,
            transform,
        };

        self.draw_buffer.write(&[data]);
    }

    fn update_material_buffer(&self, material: &Material) {
        let data = GpuMaterialData {
            color_factor: material.base_color,
            metallic_factor: material.metallic_factor,
            roughness_factor: material.roughness_factor,
            ao_strength: material.ao_strength,
            padding0: 0.,
        };

        self.material_buffer.write(&[data]);
    }

    pub fn bind_resources(
        &self,
        ctx: &RenderContext,
        primitive: &Primitive,
        material: &Material,
    ) -> Result<()> {
        let cmd = ctx.cmd_buffer;

        let base_texture = material
            .base_texture
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
            .metallic_roughness_texture
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

        ResourceBinder::default()
            .buffer(BIND_IDX_SCENE, &ctx.scene_buffer)
            .buffer(BIND_IDX_DRAW, &self.draw_buffer)
            .buffer(BIND_IDX_MATERIAL, &self.material_buffer)
            .image(BIND_IDX_BASE_COLOR, &base_texture, base_sampler)
            .image(BIND_IDX_NORMAL, &normal_texture, normal_sampler)
            .image(
                BIND_IDX_METALLIC_ROUGHNESS,
                &metalrough_texture,
                metalrough_sampler,
            )
            .image(BIND_IDX_OCCLUSION, &ao_texture, ao_sampler)
            .bind(cmd, &self.layout);

        cmd.bind_vertex_buffer(primitive.vertex_buffer.raw(), 0);
        cmd.bind_index_buffer(primitive.index_buffer.raw(), 0);

        Ok(())
    }
}
