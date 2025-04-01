use {
    crate::{
        render::renderer::RenderContext,
        scene::{
            model::{GpuDrawData, Primitive},
            util, NodeData,
        },
        vk::{
            pipeline::{Pipeline, PipelineBuilder, ResourceBinder, ResourceLayout},
            Buffer, CommandBuffer, Format, Gpu, PipelineBindPoint, PipelineLayout, Rect2D,
            VkPipeline,
        },
        Mesh,
    },
    anyhow::Result,
    ash::vk::{self, AttachmentLoadOp, AttachmentStoreOp, BufferUsageFlags, CompareOp},
    glam::Mat4,
    petgraph::{graph::NodeIndex, visit::EdgeRef},
    std::mem,
    tracing::{instrument, warn},
};

const IDX_BIND_DRAW: u32 = 0;
const CLEAR_COLOR: [f32; 4] = [0.0, 0.0, 0.0, 0.0];

const VERTEX_ATTRIBUTES: [(u32, vk::Format); 8] = [
    (0, Format::R32G32B32_SFLOAT),  // position (3x f32 = 12 bytes)
    (12, Format::R32_SFLOAT),       // texcoord0.x (1x f32 = 4 bytes)
    (16, Format::R32G32B32_SFLOAT), // normal (3x f32 = 12 bytes)
    (28, Format::R32_SFLOAT),       // texcoord0.y (1x f32 = 4 bytes)
    (32, Format::R32G32B32_SFLOAT), // tangent (4x f32 = 16 bytes)
    (48, Format::R32G32B32_SFLOAT), // color (4x f32 = 16 bytes)
    (60, Format::R32G32B32_SFLOAT), // normal_derived (3x f32 = 12 bytes)
    (72, Format::R32_SFLOAT),       // padding (1x f32 = 4 bytes)
];

pub struct DebugPipeline {
    handle: VkPipeline,
    pipeline_layout: PipelineLayout,
    draw_buffer: Buffer<GpuDrawData>,
}

impl Pipeline for DebugPipeline {
    #[instrument(skip_all)]
    fn execute(&self, context: &RenderContext) -> Result<()> {
        let color_attachments = &[util::color_attachment(
            context.draw_image,
            AttachmentLoadOp::LOAD,
            AttachmentStoreOp::STORE,
            CLEAR_COLOR,
        )];
        let depth_attachment = &util::depth_attachment(
            context.depth_image,
            AttachmentLoadOp::LOAD,
            AttachmentStoreOp::STORE,
            1.0,
        );
        let viewport = util::viewport_inverted(context.extent);

        context.cmd_buffer.begin_rendering(
            color_attachments,
            Some(depth_attachment),
            context.extent,
        )?;
        context.cmd_buffer.set_viewport(viewport);
        context
            .cmd_buffer
            .set_scissor(Rect2D::default().extent(context.extent));
        context.cmd_buffer.set_line_width(1.0);
        context
            .cmd_buffer
            .bind_pipeline(PipelineBindPoint::GRAPHICS, self.handle)?;

        self.draw_scene(context);

        context.cmd_buffer.end_rendering()
    }
}

impl DebugPipeline {
    pub fn new(gpu: &Gpu) -> Result<Self> {
        let descriptor_layout = ResourceLayout::default()
            .buffer(IDX_BIND_DRAW, vk::ShaderStageFlags::ALL_GRAPHICS)
            .layout(gpu)?;

        let pipeline_layout = gpu.create_pipeline_layout(&[descriptor_layout], &[])?;
        let handle = Self::create_pipeline(gpu, pipeline_layout)?;

        let draw_buffer = gpu.create_shared_buffer::<GpuDrawData>(
            mem::size_of::<GpuDrawData>() as u64,
            BufferUsageFlags::TRANSFER_DST | BufferUsageFlags::UNIFORM_BUFFER,
            "draw",
        )?;

        Ok(Self {
            handle,
            pipeline_layout,
            draw_buffer,
        })
    }

    fn draw_scene(&self, context: &RenderContext) {
        let world_transform = Mat4::IDENTITY;
        let root = NodeIndex::new(0);
        self.draw_node(context, root, world_transform);
    }

    fn draw_node(&self, context: &RenderContext, index: NodeIndex, transform: Mat4) {
        let node = &context.scene.graph[index];
        let transform = transform * node.transform;

        match &node.data {
            NodeData::Mesh(mesh) => {
                self.draw_mesh(context, mesh, transform);
            }
            _ => {
                for edge in context.scene.graph.edges(index) {
                    let child = edge.target();
                    self.draw_node(context, child, transform);
                }
            }
        }
    }

    fn draw_mesh(&self, context: &RenderContext<'_>, mesh: &Mesh, transform: Mat4) {
        for primitive in mesh.primitives.iter() {
            self.update_draw_buffer(context, primitive, transform);
            self.bind_resources(context.cmd_buffer, primitive);
            context
                .cmd_buffer
                .draw_indexed(primitive.vertex_count, 1, 0, 0, 0);
        }
    }

    fn create_pipeline(gpu: &Gpu, layout: PipelineLayout) -> Result<vk::Pipeline> {
        let geometry_shader = gpu.create_shader_module("shaders/debug.geom.spv")?;
        let vertex_shader = gpu.create_shader_module("shaders/debug.vert.spv")?;
        let fragment_shader = gpu.create_shader_module("shaders/debug.frag.spv")?;

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
            .geometry_shader(geometry_shader)
            .blend_disabled(attachments)
            .depth_enabled(CompareOp::LESS_OR_EQUAL)
            .input_topology(vk::PrimitiveTopology::TRIANGLE_LIST)
            .polygon_mode(vk::PolygonMode::FILL)
            .winding(vk::FrontFace::COUNTER_CLOCKWISE, vk::CullModeFlags::NONE)
            .multisampling_disabled()
            .dynamic_scissor()
            .dynamic_viewport()
            .dynamic_line_width()
            .build(gpu, layout)
    }

    fn update_draw_buffer(
        &self,
        context: &RenderContext,
        primitive: &Primitive,
        world_transform: Mat4,
    ) {
        let model = world_transform * primitive.transform;
        let view = context.camera.view();
        let projection = context.camera.projection();
        let view_projection = projection * view;
        let model_view = view * model;
        let model_view_projection = projection * view * model; // camera.model_view_projection(&primitive.model_matrix);
        let camera_pos = context.camera.position();
        let view_inverse = context.camera.view().inverse();
        let model_view_inverse = model_view.inverse();
        let normal = model_view.inverse().transpose();

        let data = GpuDrawData {
            model,
            view,
            projection,
            model_view,
            view_projection,
            model_view_projection,
            world_transform,
            camera_pos,
            view_inverse,
            model_view_inverse,
            normal,
            _padding: 0.0,
        };

        self.draw_buffer.write(&[data]);
    }

    pub fn bind_resources(&self, cmd: &CommandBuffer, primitive: &Primitive) {
        ResourceBinder::default()
            .buffer(IDX_BIND_DRAW, &self.draw_buffer)
            .bind(cmd, &self.pipeline_layout);

        cmd.bind_vertex_buffer(&primitive.vertex_buffer, 0);
        cmd.bind_index_buffer(&primitive.index_buffer, 0);
    }
}
