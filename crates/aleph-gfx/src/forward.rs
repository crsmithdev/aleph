use {
    crate::{GpuPushConstantData, Pipeline, PipelineBuilder, RenderContext, RenderObject},
    aleph_scene::{util, Vertex},
    aleph_vk::{
        image::Image, AttachmentLoadOp, AttachmentStoreOp, ColorComponentFlags, CommandBuffer,
        CompareOp, CullModeFlags, DescriptorSetLayout, FrontFace, Gpu, PipelineBindPoint,
        PipelineColorBlendAttachmentState, PipelineLayout, PolygonMode, PrimitiveTopology,
        PushConstantRange, Rect2D, ShaderStageFlags, VkPipeline,
    },
    anyhow::Result,
    std::mem,
    tracing::{instrument, warn},
};

const CLEAR_COLOR: [f32; 4] = [0.8, 0.8, 0.8, 1.0];
const VERTEX_SHADER_PATH: &str = "shaders/compiled/forward.vert.spv";
const FRAGMENT_SHADER_PATH: &str = "shaders/compiled/forward.frag.spv";

#[derive(Debug)]
pub struct ForwardPipeline {
    handle: VkPipeline,
    pipeline_layout: PipelineLayout,
    draw_image: Image,
    depth_image: Image,
}

impl Pipeline for ForwardPipeline {
    #[instrument(skip_all)]
    fn render(&mut self, ctx: &RenderContext, cmd: &CommandBuffer) -> Result<()> {
        let color_attachments = &[util::color_attachment(
            &self.draw_image,
            AttachmentLoadOp::CLEAR,
            AttachmentStoreOp::STORE,
            CLEAR_COLOR,
        )];
        let depth_attachment = &util::depth_attachment(
            &self.depth_image,
            AttachmentLoadOp::CLEAR,
            AttachmentStoreOp::STORE,
            1.0,
        );
        ctx.gpu.debug_utils().begin_debug_label(&cmd, "forward pipeline render");
        cmd.begin_rendering(color_attachments, Some(depth_attachment), ctx.render_extent);

        let viewport = util::viewport_inverted(ctx.render_extent);
        cmd.set_viewport(viewport);
        cmd.set_scissor(Rect2D::default().extent(ctx.render_extent));
        cmd.bind_pipeline(PipelineBindPoint::GRAPHICS, self.handle);
        ctx.binder.bind(&cmd, self.pipeline_layout, &[]);

        for object in ctx.objects {
            self.draw_object(cmd, object)?;
        }

        cmd.end_rendering();
        ctx.gpu.debug_utils().end_debug_label(&cmd);
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
            gpu.device().create_pipeline_layout(&[*descriptor_layout], &[push_constant_range])?;
        let handle = Self::create_pipeline(gpu, pipeline_layout)?;

        Ok(Self {
            handle,
            pipeline_layout,
            draw_image: draw_image.clone(),
            depth_image: depth_image.clone(),
        })
    }

    fn draw_object(&self, cmd: &CommandBuffer, object: &RenderObject) -> Result<()> {
        let push_constants = GpuPushConstantData {
            model: object.transform,
            material_index: object.material as u32,
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
        cmd.draw_indexed(
            object.index_count as u32,
            1,
            object.index_offset as u32,
            // object.vertex_offset as i32,
            0,
            0,
        );

        Ok(())
    }

    fn create_pipeline(gpu: &Gpu, layout: PipelineLayout) -> Result<VkPipeline> {
        let vertex_shader = gpu.device().create_shader_module(VERTEX_SHADER_PATH)?;
        let fragment_shader = gpu.device().create_shader_module(FRAGMENT_SHADER_PATH)?;
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
}
