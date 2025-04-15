use {
    crate::{
        pipeline::{Pipeline, PipelineBuilder, ResourceBinder, ResourceLayout},
        renderer::RenderContext,
    },
    aleph_scene::{
        model::{GpuDrawData, GpuMaterialData, Primitive},
        util, Material, Mesh, NodeData, Vertex,
    },
    aleph_vk::{
        AllocatedTexture, AttachmentLoadOp, AttachmentStoreOp, Buffer, BufferUsageFlags,
        ColorComponentFlags, CompareOp, CullModeFlags, Format, FrontFace, Gpu, PipelineBindPoint,
        PipelineColorBlendAttachmentState, PipelineLayout, PolygonMode, PrimitiveTopology, Rect2D,
        ShaderStageFlags, Texture, VkPipeline,
    },
    anyhow::Result,
    ash::vk,
    glam::Mat4,
    petgraph::{graph::NodeIndex, visit::EdgeRef},
    std::mem,
    tracing::{instrument, warn},
};

struct TextureDefaults {
    white_srgb: AllocatedTexture,
    white_linear: AllocatedTexture,
    normal: AllocatedTexture,
}

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
    texture_defaults: TextureDefaults,
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
        let texture_defaults = Self::create_default_textures(gpu)?;

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
            texture_defaults,
        })
    }

    fn draw_scene(&self, context: &RenderContext) -> Result<()> {
        let world_transform = Mat4::IDENTITY;
        let root = NodeIndex::new(0);
        self.draw_node(context, root, world_transform)
    }

    fn draw_node(
        &self,
        context: &RenderContext,
        index: NodeIndex,
        world_transform: Mat4,
    ) -> Result<()> {
        let graph = &context.scene.graph.borrow();
        let node = &graph[index];
        let transform = world_transform * node.transform;

        match &node.data {
            NodeData::Mesh(index) => {
                let mesh = &context.scene.meshes[*index];
                self.draw_mesh(context, mesh, transform)?;
            }
            _ =>
                for edge in graph.edges(index) {
                    let child = edge.target();
                    self.draw_node(context, child, transform)?;
                },
        }

        Ok(())
    }

    fn draw_mesh(&self, context: &RenderContext<'_>, mesh: &Mesh, transform: Mat4) -> Result<()> {
        for primitive in mesh.primitives.iter() {
            let material = match primitive.material_idx {
                Some(idx) => &context.scene.materials[&idx],
                None => &Material::default(),
            };
            self.update_draw_buffer(context, transform);
            self.update_material_buffer(material);
            self.bind_resources(context, primitive, &material, &context.scene.textures)?;
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

    fn create_default_textures(gpu: &Gpu) -> Result<TextureDefaults> {
        let linear = Format::R8G8B8A8_UNORM;
        let srgb = Format::R8G8B8A8_SRGB;
        let white_srgb =
            AllocatedTexture::monochrome(gpu, [1.0, 1.0, 1.0, 1.0], srgb, "default-white-srgb")?;
        let white_linear = AllocatedTexture::monochrome(
            gpu,
            [1.0, 1.0, 1.0, 1.0],
            linear,
            "default-white-linear",
        )?;
        let normal =
            AllocatedTexture::monochrome(gpu, [0.5, 0.5, 1.0, 1.0], linear, "default-normal")?;

        Ok(TextureDefaults {
            white_srgb,
            white_linear,
            normal,
        })
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
        context: &RenderContext,
        primitive: &Primitive,
        material: &Material,
        textures: &[AllocatedTexture],
    ) -> Result<()> {
        let base_texture = match material.base_texture {
            Some(index) => &textures[index],
            None => &self.texture_defaults.white_srgb,
        };
        let normal_texture = match material.normal_texture {
            Some(index) => &textures[index],
            None => &self.texture_defaults.normal,
        };
        let metallic_roughness_texture = match material.metallic_roughness_texture {
            Some(index) => &textures[index],
            None => &self.texture_defaults.white_linear,
        };
        let occlusion_texture = match material.ao_texture {
            Some(index) => &textures[index],
            None => &self.texture_defaults.white_linear,
        };
        let default_sampler = context.gpu.create_sampler(
            vk::Filter::LINEAR,
            vk::Filter::LINEAR,
            vk::SamplerMipmapMode::LINEAR,
            vk::SamplerAddressMode::REPEAT,
            vk::SamplerAddressMode::REPEAT,
        )?;

        ResourceBinder::default()
            .buffer(BIND_IDX_SCENE, &context.scene_buffer)
            .buffer(BIND_IDX_DRAW, &self.draw_buffer)
            .buffer(BIND_IDX_MATERIAL, &self.material_buffer)
            .image(
                BIND_IDX_BASE_COLOR,
                base_texture,
                base_texture.sampler().unwrap_or(default_sampler),
            )
            .image(
                BIND_IDX_NORMAL,
                normal_texture,
                normal_texture.sampler().unwrap_or(default_sampler),
            )
            .image(
                BIND_IDX_METALLIC_ROUGHNESS,
                metallic_roughness_texture,
                metallic_roughness_texture
                    .sampler()
                    .unwrap_or(default_sampler),
            )
            .image(
                BIND_IDX_OCCLUSION,
                occlusion_texture,
                occlusion_texture.sampler().unwrap_or(default_sampler),
            )
            .bind(context.cmd_buffer, &self.layout);

        context
            .cmd_buffer
            .bind_vertex_buffer(&primitive.vertex_buffer.raw(), 0);
        context
            .cmd_buffer
            .bind_index_buffer(&primitive.index_buffer.raw(), 0);

        Ok(())
    }
}
