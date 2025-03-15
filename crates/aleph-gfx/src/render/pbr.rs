use {
    crate::{
        render::renderer::RenderContext,
        scene::{
            model::{GpuDrawData, GpuMaterialData, GpuSceneData, Primitive},
            util, Camera,
        },
        vk::{
            pipeline::{Pipeline, PipelineBuilder, ResourceBinder, ResourceLayout},
            Buffer, CommandBuffer, Format, Gpu, PipelineBindPoint, PipelineLayout, Rect2D,
            VkPipeline,
        },
        Material, Mesh, Node,
    },
    anyhow::Result,
    ash::vk::{self, BufferUsageFlags, CompareOp},
    glam::{Mat3, Mat4, Vec3, Vec4Swizzles},
    petgraph::{graph::NodeIndex, visit::Dfs},
    std::mem,
    tracing::{instrument, warn},
};

const IDX_SCENE_BUFFER: u32 = 0;
const IDX_MATERIAL_BUFFER: u32 = 1;
const IDX_DRAW_BUFFER: u32 = 2;
const IDX_ALBEDO: u32 = 3;
const IDX_NORMAL: u32 = 4;
const IDX_METALLIC: u32 = 5;
const IDX_ROUGHNESS: u32 = 6;
const IDX_AO: u32 = 7;

const VERTEX_SHADER_PATH: &str = "shaders/mesh.vert.spv";
const FRAGMENT_SHADER_PATH: &str = "shaders/mesh.frag.spv";
const VERTEX_ATTRIBUTES: [(u32, vk::Format); 7] = [
    (0, Format::R32G32B32_SFLOAT),
    (12, Format::R32_SFLOAT),
    (16, Format::R32G32B32_SFLOAT),
    (28, Format::R32_SFLOAT),
    (32, Format::R32G32_SFLOAT),
    (40, Format::R32G32_SFLOAT),
    (48, Format::R32G32B32A32_SFLOAT),
];

pub struct PbrPipeline {
    handle: VkPipeline,
    pipeline_layout: PipelineLayout,
    material_buffer: Buffer<GpuMaterialData>,
}

impl Pipeline for PbrPipeline {
    #[instrument(skip_all)]
    fn execute(&self, ctx: &RenderContext) -> Result<()> {
        let color_attachments = &[util::color_attachment(ctx.draw_image)];
        let depth_attachment = &util::depth_attachment(ctx.depth_image);
        let viewport = vk::Viewport::default()
            .width(ctx.extent.width as f32)
            .height(0.0 - ctx.extent.height as f32)
            .x(0.)
            .y(ctx.extent.height as f32)
            .min_depth(0.)
            .max_depth(1.);

        ctx.cmd_buffer
            .begin_rendering(color_attachments, Some(depth_attachment), ctx.extent)?;
        ctx.cmd_buffer.set_viewport(viewport);
        ctx.cmd_buffer
            .set_scissor(Rect2D::default().extent(ctx.extent));
        ctx.cmd_buffer
            .bind_pipeline(PipelineBindPoint::GRAPHICS, self.handle)?;

        let mut dfs = Dfs::new(&ctx.scene.root, NodeIndex::new(0));
        while let Some(index) = dfs.next(&ctx.scene.root) {
            if let Node::Mesh(mesh) = &ctx.scene.root[index] {
                self.draw_mesh(ctx, mesh);
            }
        }
        
        ctx.cmd_buffer.end_rendering()
    }
}

impl PbrPipeline {
    pub fn new(gpu: &Gpu) -> Result<Self> {
        let descriptor_layout = ResourceLayout::default()
            .buffer(IDX_SCENE_BUFFER, vk::ShaderStageFlags::ALL_GRAPHICS)
            .buffer(IDX_MATERIAL_BUFFER, vk::ShaderStageFlags::ALL_GRAPHICS)
            .buffer(IDX_DRAW_BUFFER, vk::ShaderStageFlags::ALL_GRAPHICS)
            .image(IDX_ALBEDO, vk::ShaderStageFlags::FRAGMENT)
            .image(IDX_NORMAL, vk::ShaderStageFlags::FRAGMENT)
            .image(IDX_METALLIC, vk::ShaderStageFlags::FRAGMENT)
            .image(IDX_ROUGHNESS, vk::ShaderStageFlags::FRAGMENT)
            .image(IDX_AO, vk::ShaderStageFlags::FRAGMENT)
            .layout(gpu)?;

        let pipeline_layout = gpu.create_pipeline_layout(&[descriptor_layout], &[])?;
        let handle = Self::create_pipeline(gpu, pipeline_layout)?;

        let material_buffer = gpu.create_shared_buffer::<GpuMaterialData>(
            mem::size_of::<GpuMaterialData>() as u64,
            BufferUsageFlags::TRANSFER_DST | BufferUsageFlags::UNIFORM_BUFFER,
            "pbr-material",
        )?;

        Ok(Self {
            handle,
            pipeline_layout,
            material_buffer,
        })
    }

    fn create_pipeline(gpu: &Gpu, layout: PipelineLayout) -> Result<vk::Pipeline> {
        let vertex_shader = gpu.create_shader_module(VERTEX_SHADER_PATH)?;
        let fragment_shader = gpu.create_shader_module(FRAGMENT_SHADER_PATH)?;
        let attachments = &[vk::PipelineColorBlendAttachmentState::default()
            .blend_enable(false)
            .color_write_mask(
                vk::ColorComponentFlags::A
                    | vk::ColorComponentFlags::R
                    | vk::ColorComponentFlags::G
                    | vk::ColorComponentFlags::B,
            )];

        PipelineBuilder::default() // TODO verify defaults
            .vertex_attributes(&VERTEX_ATTRIBUTES)
            .vertex_shader(vertex_shader)
            .fragment_shader(fragment_shader)
            .blend_disabled(attachments)
            .depth_enabled(CompareOp::LESS_OR_EQUAL)
            .input_topology(vk::PrimitiveTopology::TRIANGLE_LIST)
            .polygon_mode(vk::PolygonMode::FILL)
            .winding(vk::FrontFace::COUNTER_CLOCKWISE, vk::CullModeFlags::NONE)
            .multisampling_disabled()
            .dynamic_scissor()
            .dynamic_viewport()
            .build(gpu, layout)
    }

    fn update_draw_buffer(&self, primitive: &Primitive, transform: Mat4, camera: &Camera) {
        let model = primitive.model_matrix;
        let model_view = camera.view() * transform;
        let model_view_projection = camera.model_view_projection(&primitive.model_matrix);
        let normal = Mat3::from_mat4(model_view.inverse()).transpose();

        let model_data = GpuDrawData {
            model,
            model_view,
            model_view_projection,
            position: model.w_axis.xyz(),
            normal,
            world_matrix: transform,
            padding1: Vec3::ZERO,
            padding2: 0.0,
        };

        primitive.model_buffer.write(&[model_data]);
    }

    pub fn bind_resources(
        &self,
        cmd: &CommandBuffer,
        primitive: &Primitive,
        scene_buffer: &Buffer<GpuSceneData>,
        material: Option<&Material>,
    ) {
        let mut binder = ResourceBinder::default();

        binder
            .buffer(IDX_SCENE_BUFFER, scene_buffer)
            .buffer(IDX_MATERIAL_BUFFER, &self.material_buffer)
            .buffer(IDX_DRAW_BUFFER, &primitive.model_buffer);

        if let Some(material) = material {
            binder
                .image(IDX_ALBEDO, &material.albedo_map, material.albedo_sampler)
                .image(IDX_NORMAL, &material.normal_map, material.normal_sampler)
                .image(
                    IDX_METALLIC,
                    &material.metallic_map,
                    material.metallic_sampler,
                )
                .image(
                    IDX_ROUGHNESS,
                    &material.roughness_map,
                    material.roughness_sampler,
                )
                .image(IDX_AO, &material.occlusion_map, material.occlusion_sampler);
        }
        binder.bind(cmd, &self.pipeline_layout);

        cmd.bind_vertex_buffer(&primitive.vertex_buffer, 0);
        cmd.bind_index_buffer(&primitive.index_buffer, 0);
    }

    fn draw_mesh(&self, context: &RenderContext<'_>, mesh: &Mesh) {
        for primitive in mesh.primitives.iter() {
            let material = primitive
                .material
                .as_ref()
                .and_then(|handle| context.assets.get_material(*handle));
            self.update_draw_buffer(primitive, mesh.world_matrix, &context.camera);
            self.bind_resources(
                context.cmd_buffer,
                primitive,
                context.global_buffer,
                material,
            );
            context
                .cmd_buffer
                .draw_indexed(primitive.vertex_count, 1, 0, 0, 0);
        }
    }
}
