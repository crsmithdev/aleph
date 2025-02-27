use {
    crate::{
        graph::{util, GpuMaterialData, RenderContext},
        vk::{
            pipeline::{Pipeline, PipelineBuilder, ResourceBinder, ResourceLayout}, Format, Gpu, Pipeline as VkPipeline, PipelineBindPoint, PipelineLayout,
            Rect2D, Buffer, Viewport,
        },
    },
    anyhow::Result,
    ash::vk::{self, BufferUsageFlags, CompareOp},
    glam::vec4,
    std::mem,
};

const IDX_SCENE_BUFFER: u32 = 0;
const IDX_MATERIAL_BUFFER: u32 = 1;
const IDX_DRAW_BUFFER: u32 = 2;
const VERTEX_SHADER_PATH: &str = "shaders/mesh.vert.spv";
const FRAGMENT_SHADER_PATH: &str = "shaders/mesh.frag.spv";
const VERTEX_ATTRIBUTES: [(u32, vk::Format); 3] = [
    (0, Format::R32G32B32_SFLOAT),
    (12, Format::R32G32B32_SFLOAT),
    (24, Format::R32G32_SFLOAT),
];

pub trait ViewportExt {
    fn from_extent(extent: vk::Extent2D) -> Self;
}
impl ViewportExt for vk::Viewport {
    fn from_extent(extent: vk::Extent2D) -> Self {
        vk::Viewport::default()
            .width(extent.width as f32)
            .height(0.0 - extent.height as f32)
            .x(0.)
            .y(extent.height as f32)
    }
}

pub struct MeshPipeline {
    handle: VkPipeline,
    pipeline_layout: PipelineLayout,
    material_buffer: Buffer<GpuMaterialData>,
}

impl Pipeline for MeshPipeline {
    fn execute(&self, context: &RenderContext) -> Result<()> {
        let color_attachments = &[util::color_attachment(context.draw_image)];
        let depth_attachment = &util::depth_attachment(context.depth_image);
        let cmd_buffer = context.cmd_buffer;

        let extent = context.extent;
        cmd_buffer.begin_rendering(color_attachments, Some(depth_attachment), context.extent)?;
        let viewport = Viewport::from_extent(context.extent)
            .min_depth(0.)
            .max_depth(1.);

        cmd_buffer.set_viewport(viewport);
        cmd_buffer.set_scissor(Rect2D::default().extent(extent));
        cmd_buffer.bind_pipeline(PipelineBindPoint::GRAPHICS, self.handle)?;

        for object in context.objects.objects.iter() {
            ResourceBinder::default()
                .buffer(IDX_SCENE_BUFFER, context.global_buffer)
                .buffer(IDX_MATERIAL_BUFFER, &self.material_buffer)
                .buffer(IDX_DRAW_BUFFER, &object.model_buffer)
                .bind(cmd_buffer, &self.pipeline_layout);
            object.bind_mesh_buffers(cmd_buffer);
            object.draw(cmd_buffer);
        }

        cmd_buffer.end_rendering()?;
        Ok(())
    }
}

impl MeshPipeline {
    pub fn new(gpu: &Gpu) -> Result<Self> {
        let descriptor_layout = ResourceLayout::default()
            .buffer(IDX_SCENE_BUFFER, vk::ShaderStageFlags::ALL_GRAPHICS)
            .buffer(IDX_MATERIAL_BUFFER, vk::ShaderStageFlags::ALL_GRAPHICS)
            .buffer(IDX_DRAW_BUFFER, vk::ShaderStageFlags::ALL_GRAPHICS)
            .layout(gpu)?;

        let pipeline_layout = gpu.create_pipeline_layout(&[descriptor_layout], &[])?;
        let handle = Self::create_pipeline(gpu, pipeline_layout)?;

        let material_buffer = gpu.create_shared_buffer::<GpuMaterialData>(
                mem::size_of::<GpuMaterialData>() as u64,
                BufferUsageFlags::TRANSFER_DST | BufferUsageFlags::UNIFORM_BUFFER,
                "material",
        )?;
        material_buffer.write(&[GpuMaterialData {
            albedo: vec4(0.0, 0.0, 1.0, 1.0),
            metallic: 1.0,
            roughness: 0.1,
            ao: 1.0,
            _padding: 0.,
        }]);

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
}
