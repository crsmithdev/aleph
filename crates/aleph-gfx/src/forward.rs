use {
    crate::{
        renderer::{GpuPushConstantData, RenderObject},
        Pipeline, PipelineBuilder, RenderContext,
    },
    aleph_scene::{util, Vertex},
    aleph_vk::{
        texture::Image, AttachmentLoadOp, AttachmentStoreOp, ColorComponentFlags, CommandBuffer,
        CompareOp, CullModeFlags, DescriptorSetLayout, FrontFace, Gpu, PipelineBindPoint,
        PipelineColorBlendAttachmentState, PipelineLayout, PolygonMode, PrimitiveTopology,
        PushConstantRange, Rect2D, ShaderStageFlags, VkPipeline,
    },
    anyhow::Result,
    std::mem,
    tracing::{instrument, warn},
};

const CLEAR_COLOR: [f32; 4] = [0.0, 0.0, 0.0, 1.0];

const VERTEX_SHADER_PATH: &str = "shaders/forward.vert.spv";
const FRAGMENT_SHADER_PATH: &str = "shaders/forward.frag.spv";

#[derive(Debug)]
pub struct ForwardPipeline {
    handle: VkPipeline,
    pipeline_layout: PipelineLayout,
    draw_image: Image,
    depth_image: Image,
}

impl Pipeline for ForwardPipeline {
    #[instrument(skip_all)]
    fn render(&mut self, ctx: &RenderContext) -> Result<()> {
        log::trace!("Begin forward pipeline render");
        let cmd = &ctx.command_buffer;
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
        let viewport = util::viewport_inverted(ctx.extent);
        cmd.begin_rendering(color_attachments, Some(depth_attachment), ctx.extent);
        cmd.set_viewport(viewport);
        cmd.set_scissor(Rect2D::default().extent(ctx.extent));

        cmd.bind_pipeline(PipelineBindPoint::GRAPHICS, self.handle);
        ctx.binder.bind(&ctx, self.pipeline_layout, &[]);

        for object in &ctx.objects {
            self.draw_primitive(cmd, object)?;
        }
        cmd.end_rendering();
        log::trace!("End forward pipeline render");
        Ok(())
    }
}

impl ForwardPipeline {
    pub fn new(
        gpu: &Gpu,
        descriptor_layout: &DescriptorSetLayout,
        draw_image: &Image,
        depth_image: &Image,
    ) -> Result<Self> {
        let push_constant_range = PushConstantRange {
            stage_flags: ShaderStageFlags::VERTEX | ShaderStageFlags::FRAGMENT,
            offset: 0,
            size: mem::size_of::<GpuPushConstantData>() as u32,
        };
        let pipeline_layout =
            gpu.create_pipeline_layout(&[*descriptor_layout], &[push_constant_range])?;
        let handle = Self::create_pipeline(gpu, pipeline_layout)?;

        Ok(Self {
            handle,
            pipeline_layout,
            draw_image: draw_image.clone(),
            depth_image: depth_image.clone(),
        })
    }

    fn draw_primitive(&self, cmd: &CommandBuffer, object: &RenderObject) -> Result<()> {
        cmd.bind_index_buffer(&*object.primitive.index_buffer, 0);
        cmd.bind_vertex_buffer(&*object.primitive.vertex_buffer, 0);

        let push_constants = GpuPushConstantData {
            model: object.transform,
            material_index: object.material as i32,
            _padding0: 0,
            _padding1: 0,
            _padding2: 0,
        };
        cmd.push_constants(
            self.pipeline_layout,
            ShaderStageFlags::VERTEX | ShaderStageFlags::FRAGMENT,
            0,
            &push_constants,
        );
        cmd.draw_indexed(object.primitive.vertex_count, 1, 0, 0, 0);

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
