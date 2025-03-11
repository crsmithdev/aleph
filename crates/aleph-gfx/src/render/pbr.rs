use {
    crate::{
        render::renderer::RenderContext,
        scene::{
            material::AssetHandle,
            model::{GpuDrawData, GpuMaterialData, Primitive},
            util, Camera,
        },
        vk::{
            pipeline::{Pipeline, PipelineBuilder, ResourceBinder, ResourceLayout},
            Buffer, Format, Gpu, PipelineBindPoint, PipelineLayout, Rect2D, VkPipeline,
        },
        AssetCache,
    },
    anyhow::Result,
    ash::vk::{self, BufferUsageFlags, CompareOp},
    glam::{vec4, Mat3, Mat4, Vec3, Vec4Swizzles},
    petgraph::{graph::{edge_index, NodeIndex}, visit::Dfs},
    std::{mem, primitive},
};

pub fn calculate_global_transform(
    local_transform: Mat4,
    node_index: NodeIndex,
    graph: &crate::scene::model::Graph,
) -> Mat4 {
    let indices: Vec<NodeIndex> = vec![];
    // let indices = gltf::path_between_nodes(NodeIndex::new(0), node_index, graph);
    indices.iter().fold(Mat4::IDENTITY, |transform, _| {
        transform * local_transform /* graph[*index].animation_transform.matrix()*.*/
    })
}

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
    fn execute(&self, context: &RenderContext) -> Result<()> {
        let color_attachments = &[util::color_attachment(context.draw_image)];
        let depth_attachment = &util::depth_attachment(context.depth_image);
        let cmd_buffer = context.cmd_buffer;

        let extent = context.extent;
        cmd_buffer.begin_rendering(color_attachments, Some(depth_attachment), context.extent)?;

        let viewport = vk::Viewport::default()
            .width(extent.width as f32)
            .height(0.0 - extent.height as f32)
            .x(0.)
            .y(extent.height as f32)
            .min_depth(0.)
            .max_depth(1.);

        cmd_buffer.set_viewport(viewport);
        cmd_buffer.set_scissor(Rect2D::default().extent(extent));
        cmd_buffer.bind_pipeline(PipelineBindPoint::GRAPHICS, self.handle)?;

        let mut dfs = Dfs::new(&context.scene.graph, NodeIndex::new(0));
            while let Some(node_index) = dfs.next(&context.scene. graph) {
                match &context.scene.graph[node_index] {
                    crate::scene::model::Node::Mesh(mesh) 
                     => {
                        let global_transform = mesh.local_transform; //`calculate_global_transform(*local_transform, node_index, graph);
                        for primitive_info in mesh.primitives.iter() {
                            self.update_model_buffer(
                                primitive_info,
                                global_transform,
                                context.camera,
                            );
                            let handle = primitive_info.material.unwrap_or(AssetHandle{id:0});
                            // if let Some(handle) = primitive_info.material {
                                let material = context.assets.get_material(handle).unwrap();
                                ResourceBinder::default()
                                    .buffer(IDX_SCENE_BUFFER, context.global_buffer)
                                    .buffer(IDX_MATERIAL_BUFFER, &self.material_buffer)
                                    .buffer(IDX_DRAW_BUFFER, &primitive_info.model_buffer)
                                    .image(IDX_ALBEDO, &material.base_color_texture)
                                    .image(IDX_NORMAL, &material.normal_texture)
                                    .image(IDX_METALLIC, &material.metallic_roughness_texture)
                                    // .image(IDX_ROUGHNESS, &material.roughness_texture)
                                    .image(IDX_AO, &material.occlusion_texture)
                                    .bind(cmd_buffer, &self.pipeline_layout);
                            // }
                                cmd_buffer.bind_vertex_buffer(&primitive_info.vertex_buffer, 0);
                                cmd_buffer.bind_index_buffer(&primitive_info.index_buffer, 0);
                                self.material_buffer.write(&[GpuMaterialData {
                                    albedo: vec4(0.0, 0.0, 1.0, 1.0),
                                    metallic: 1.0,
                                    roughness: 0.1,
                                    ao: 1.0,
                                    _padding: 0.,
                                }]);
                            cmd_buffer.draw_indexed(primitive_info.vertex_count, 1, 0, 0, 0);
                            }
                    }
                    _ => {}
                };
            }
        cmd_buffer.end_rendering()?;
        Ok(())
    }
}

pub struct MaterialDefaults {
    pub base_color_texture: AssetHandle,
    pub normal_texture: AssetHandle,
    pub metallic_texture: AssetHandle,
    pub roughness_texture: AssetHandle,
    pub occlusion_texture: AssetHandle,
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

    fn update_model_buffer(&self, primitive: &Primitive, transform: Mat4, camera: &Camera) {
        let model_view_projection = camera.model_view_projection(&primitive.model_matrix);
        let model = primitive.model_matrix;
        let model_view = camera.view() * transform;
        let inverse_model_view = model_view.inverse();
        let normal = Mat3::from_mat4(inverse_model_view).transpose();

        let model_data = GpuDrawData {
            model,
            model_view,
            model_view_projection,
            position: model.w_axis.xyz(),
            normal,
            padding1: Vec3::ZERO,
            padding2: 0.0,
        };

        primitive.model_buffer.write(&[model_data]);
    }
}
