// use {
//     crate::{
//         pipeline::{Pipeline, PipelineBuilder, ResourceBinder, ResourceLayout},
//         renderer::{GpuDrawData, RenderContext},
//     },
//     aleph_scene::{model::Primitive, util, Mesh, NodeData, Vertex},
//     aleph_vk::{
//         AttachmentStoreOp, Buffer, BufferUsageFlags, Gpu, PipelineBindPoint, PipelineLayout,
//         Rect2D, VkPipeline,
//     },
//     anyhow::Result,
//     ash::vk::{self, AttachmentLoadOp, CompareOp},
//     glam::Mat4,
//     petgraph::{graph::NodeIndex, visit::EdgeRef},
//     std::mem,
//     tracing::{instrument, warn},
// };

// const BIND_IDX_SCENE: u32 = 0;
// const BIND_IDX_DRAW: u32 = 1;
// const CLEAR_COLOR: [f32; 4] = [0.0, 0.0, 0.0, 1.0];

// pub struct DebugPipeline {
//     handle: VkPipeline,
//     pipeline_layout: PipelineLayout,
//     draw_buffer: Buffer<GpuDrawData>,
// }

// impl Pipeline for DebugPipeline {
//     #[instrument(skip_all)]
//     fn execute(&self, context: &RenderContext) -> Result<()> {
//         let color_attachments = &[util::color_attachment(
//             context.draw_image,
//             AttachmentLoadOp::LOAD,
//             AttachmentStoreOp::STORE,
//             CLEAR_COLOR,
//         )];
//         let depth_attachment = &util::depth_attachment(
//             context.depth_image,
//             AttachmentLoadOp::LOAD,
//             AttachmentStoreOp::STORE,
//             1.0,
//         );
//         let viewport = util::viewport_inverted(context.extent);

//         context.cmd_buffer.begin_rendering(
//             color_attachments,
//             Some(depth_attachment),
//             context.extent,
//         )?;
//         context.cmd_buffer.set_viewport(viewport);
//         context
//             .cmd_buffer
//             .set_scissor(Rect2D::default().extent(context.extent));
//         context.cmd_buffer.set_line_width(1.0);
//         context
//             .cmd_buffer
//             .bind_pipeline(PipelineBindPoint::GRAPHICS, self.handle)?;

//         self.draw_scene(context);

//         context.cmd_buffer.end_rendering()
//     }
// }

// impl DebugPipeline {
//     pub fn new(gpu: &Gpu) -> Result<Self> {
//         let descriptor_layout = ResourceLayout::default()
//             .buffer(BIND_IDX_SCENE, vk::ShaderStageFlags::ALL_GRAPHICS)
//             .buffer(BIND_IDX_DRAW, vk::ShaderStageFlags::ALL_GRAPHICS)
//             .layout(gpu)?;

//         let pipeline_layout = gpu.create_pipeline_layout(&[descriptor_layout], &[])?;
//         let handle = Self::create_pipeline(gpu, pipeline_layout)?;

//         let draw_buffer = gpu.create_shared_buffer::<GpuDrawData>(
//             mem::size_of::<GpuDrawData>() as u64,
//             BufferUsageFlags::TRANSFER_DST | BufferUsageFlags::UNIFORM_BUFFER,
//             "draw",
//         )?;

//         Ok(Self {
//             handle,
//             pipeline_layout,
//             draw_buffer,
//         })
//     }

//     fn draw_scene(&self, context: &RenderContext) {
//         let root = NodeIndex::new(0);
//         self.draw_node(context, root, Mat4::IDENTITY);
//     }

//     fn draw_node(&self, context: &RenderContext, index: NodeIndex, transform: Mat4) {
//         let graph = &context.scene.graph.borrow();
//         let node = &graph[index];
//         let transform = transform * node.transform;

//         match &node.data {
//             NodeData::Mesh(index) => {
//                 let mesh = &assets.mesh() context.scene.meshes[*index];
//                 self.draw_mesh(context, mesh, transform);
//             }
//             _ =>
//                 for edge in graph.edges(index) {
//                     let child = edge.target();
//                     self.draw_node(context, child, transform);
//                 },
//         }
//     }

//     fn draw_mesh(&self, context: &RenderContext, mesh: &Mesh, transform: Mat4) {
//         for primitive in mesh.primitives.iter() {
//             self.update_draw_buffer(context, transform);
//             self.bind_resources(context, primitive);
//             context
//                 .cmd_buffer
//                 .draw_indexed(primitive.vertex_count, 1, 0, 0, 0);
//         }
//     }

//     fn create_pipeline(gpu: &Gpu, layout: PipelineLayout) -> Result<vk::Pipeline> {
//         let geometry_shader = gpu.create_shader_module("shaders/debug.geom.spv")?;
//         let vertex_shader = gpu.create_shader_module("shaders/debug.vert.spv")?;
//         let fragment_shader = gpu.create_shader_module("shaders/debug.frag.spv")?;

//         let attachments = &[vk::PipelineColorBlendAttachmentState::default()
//             .blend_enable(false)
//             .color_write_mask(
//                 vk::ColorComponentFlags::A
//                     | vk::ColorComponentFlags::R
//                     | vk::ColorComponentFlags::G
//                     | vk::ColorComponentFlags::B,
//             )];
//         PipelineBuilder::default() // TODO verify defaults
//             .vertex_attributes(&Vertex::binding_attributes())
//             .vertex_shader(vertex_shader)
//             .fragment_shader(fragment_shader)
//             .geometry_shader(geometry_shader)
//             .blend_disabled(attachments)
//             .depth_enabled(CompareOp::LESS_OR_EQUAL)
//             .input_topology(vk::PrimitiveTopology::TRIANGLE_LIST)
//             .polygon_mode(vk::PolygonMode::FILL)
//             .winding(vk::FrontFace::COUNTER_CLOCKWISE, vk::CullModeFlags::NONE)
//             .multisampling_disabled()
//             .dynamic_scissor()
//             .dynamic_viewport()
//             .dynamic_line_width()
//             .build(gpu, layout)
//     }

//     fn update_draw_buffer(&self, context: &RenderContext, transform: Mat4) {
//         let view = context.scene.camera.view();

//         let model = transform;
//         let mv = view * model;
//         let mvp = context.scene.camera.projection() * view * model;

//         let data = GpuDrawData {
//             model,
//             mv,
//             mvp,
//             transform,
//         };

//         self.draw_buffer.write(&[data]);
//     }

//     pub fn bind_resources(&self, context: &RenderContext, primitive: &Primitive) {
//         ResourceBinder::default()
//             .buffer(BIND_IDX_SCENE, context.scene_buffer)
//             .buffer(BIND_IDX_DRAW, &self.draw_buffer)
//             .bind(context.cmd_buffer, &self.pipeline_layout);

//         context
//             .cmd_buffer
//             .bind_vertex_buffer(&primitive.vertex_buffer.raw(), 0);
//         context
//             .cmd_buffer
//             .bind_index_buffer(&primitive.index_buffer.raw(), 0);
//     }
// }
