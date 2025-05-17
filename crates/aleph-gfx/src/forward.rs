use {
    crate::{
        renderer::{GpuMaterialData, GpuPushConstantData},
        Pipeline, PipelineBuilder, RenderContext, ResourceBinder, ResourceLayout,
    },
    aleph_scene::{model::Primitive, util, MaterialHandle, NodeType, TextureHandle, Vertex},
    aleph_vk::{
        AttachmentLoadOp, AttachmentStoreOp, Buffer, BufferUsageFlags, ColorComponentFlags,
        CompareOp, CullModeFlags, DescriptorSetLayout, FrontFace, Gpu, PipelineBindPoint,
        PipelineColorBlendAttachmentState, PipelineLayout, PolygonMode, PrimitiveTopology,
        PushConstantRange, Rect2D, ShaderStageFlags, VkPipeline,
    },
    anyhow::Result,
    glam::Mat4,
    std::{collections::HashMap, mem},
    tracing::{instrument, warn},
};

const SET_IDX_BINDLESS: usize = 0;
const BIND_IDX_SCENE: usize = 0;
const BIND_IDX_MATERIAL: usize = 1;
const BIND_IDX_TEXTURE: usize = 2;
const CLEAR_COLOR: [f32; 4] = [0.0, 0.0, 0.0, 1.0];

const VERTEX_SHADER_PATH: &str = "shaders/forward.vert.spv";
const FRAGMENT_SHADER_PATH: &str = "shaders/forward.frag.spv";

struct Drawable {
    primitive: usize,
    material: Option<MaterialHandle>,
    transform: Mat4,
}

pub struct ForwardPipeline {
    handle: VkPipeline,
    pipeline_layout: PipelineLayout,
}

impl Pipeline for ForwardPipeline {
    #[instrument(skip_all)]
    fn render(&mut self, ctx: &RenderContext) -> Result<()> {
        let cmd = ctx.command_buffer;

        let color_attachments = &[util::color_attachment(
            ctx.draw_image,
            AttachmentLoadOp::CLEAR,
            AttachmentStoreOp::STORE,
            CLEAR_COLOR,
        )];
        let depth_attachment = &util::depth_attachment(
            ctx.depth_image,
            AttachmentLoadOp::CLEAR,
            AttachmentStoreOp::STORE,
            1.0,
        );
        let viewport = util::viewport_inverted(ctx.extent.into());
        cmd.begin_rendering(color_attachments, Some(depth_attachment), ctx.extent)?;
        cmd.set_viewport(viewport);
        cmd.set_scissor(Rect2D::default().extent(ctx.extent));

        let drawables = Self::get_drawables(ctx);

        cmd.bind_pipeline(PipelineBindPoint::GRAPHICS, self.handle)?;

        self.draw(ctx, drawables, ctx.material_map.clone())?;

        cmd.end_rendering()
    }
}

impl ForwardPipeline {
    pub fn new(gpu: &Gpu, descriptor_layout: DescriptorSetLayout) -> Result<Self> {
        let push_constant_range = PushConstantRange {
            stage_flags: ShaderStageFlags::VERTEX,
            offset: 0,
            size: mem::size_of::<GpuPushConstantData>() as u32,
        };
        let pipeline_layout =
            gpu.create_pipeline_layout(&[descriptor_layout], &[push_constant_range])?;
        let handle = Self::create_pipeline(gpu, pipeline_layout)?;

        Ok(Self {
            handle,
            pipeline_layout,
        })
    }
    fn draw(
        &mut self,
        ctx: &RenderContext,
        drawables: Vec<(&Primitive, Option<MaterialHandle>, Mat4)>,
        material_map: HashMap<MaterialHandle, usize>,
    ) -> Result<()> {
        for (primitive, material_handle, transform) in drawables.iter() {
            let material_index = material_handle
                .and_then(|h| material_map.get(&h))
                .unwrap_or(&0);
            self.draw_primitive(ctx, primitive, *material_index as i32, *transform)?;
        }
        Ok(())
    }

    fn draw_primitive(
        &mut self,
        ctx: &RenderContext,
        primitive: &Primitive,
        material_index: i32,
        transform: Mat4,
    ) -> Result<()> {
        let cmd = ctx.command_buffer;
        cmd.bind_index_buffer(primitive.index_buffer.raw(), 0);
        cmd.bind_vertex_buffer(primitive.vertex_buffer.raw(), 0);

        let push_constants = GpuPushConstantData {
            model: transform,
            material_index,
            _padding0: 0,
            _padding1: 0,
            _padding2: 0,
        };
        cmd.push_constants(
            self.pipeline_layout,
            ShaderStageFlags::VERTEX,
            0,
            &push_constants,
        );
        cmd.draw_indexed(primitive.vertex_count, 1, 0, 0, 0);

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

    fn get_drawables<'a>(
        ctx: &'a RenderContext,
    ) -> Vec<(&'a Primitive, Option<MaterialHandle>, Mat4)> {
        let mut drawables = vec![];
        for node in ctx.scene.mesh_nodes() {
            match node.data {
                NodeType::Mesh(handle) => {
                    let mesh = ctx.assets.mesh(handle).unwrap();
                    let transform = node.transform;
                    for primitive in mesh.primitives.iter() {
                        drawables.push((primitive, primitive.material, transform))
                    }
                }
                _ => {}
            }
        }
        drawables
    }

    // fn update_draw_buffer(&mut self, context: &RenderContext, transforms: Vec<Mat4>) -> Result<()> {
    //     log::debug!("update draw");
    //     let data = transforms
    //         .into_iter()
    //         .map(|t| GpuDrawData { model: t })
    //         .collect::<Vec<_>>();
    //     self.draw_buffer.write(&data);

    //     self.draw_resources
    //         .dynamic_uniform_buffer(BIND_IDX_DRAW, &self.draw_buffer, 0, 64 * data.len() as u64)
    //         .update(context)?;
    //     Ok(())
    // }

    // pub fn bind_draw(&self, ctx: &RenderContext, primitive: &Primitive) -> Result<()> {
    //     let cmd = ctx.command_buffer;
    //     cmd.bind_index_buffer(primitive.index_buffer.raw(), 0);
    //     cmd.bind_vertex_buffer(primitive.vertex_buffer.raw(), 0);

    //     // let offsets = [offset as u32 * mem::size_of::<GpuDrawData>() as u32];
    //     // self.draw_resources
    //     // .bind(ctx, self.pipeline_layout, &offsets);

    //     Ok(())
    // }

    // fn get_batches<'a>(
    //     ctx: &'a RenderContext<'_>,
    // ) -> HashMap<Option<aleph_scene::assets::AssetHandle<Material>>, Vec<(&'a Primitive, Mat4)>>
    // {
    //     let mut material_batches: HashMap<Option<MaterialHandle>, Vec<(&Primitive, Mat4)>> =
    //         HashMap::new();

    //     for node in ctx.scene.mesh_nodes() {
    //         match node.data {
    //             NodeType::Mesh(handle) => {
    //                 let mesh = ctx.assets.mesh(handle).unwrap();
    //                 let transform = node.transform;
    //                 for primitive in mesh.primitives.iter() {
    //                     material_batches
    //                         .entry(None)
    //                         .or_default()
    //                         .push((primitive, transform))
    //                 }
    //             }
    //             _ => {}
    //         }
    //     }
    //     material_batches
    // }
}

// pub unsafe fn mem_copy_aligned<T: Copy>(ptr: *mut c_void, alignment: DeviceSize, data: &[T]) {
//     let size = data.len() as DeviceSize * alignment;
//     let mut align = Align::new(ptr, alignment, size);
//     align.copy_from_slice(data);
// }
