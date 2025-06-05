use {
    crate::{ForwardPipeline, Gui, Pipeline, ResourceBinder, ResourceLayout},
    aleph_scene::{
        assets::{BindlessData, GpuMaterial},
        graph::NodeData,
        model::Light,
        Assets, Material, MaterialHandle, MeshHandle, Scene, Vertex,
    },
    aleph_vk::{
        sync, AccessFlags2, CommandBuffer, CommandPool, Extent2D, Fence, Format, Gpu,
        Handle as VkHandle, ImageAspectFlags, ImageLayout, ImageUsageFlags, PipelineStageFlags2,
        Semaphore, ShaderStageFlags, Texture, TextureInfo, TypedBuffer,
    },
    anyhow::Result,
    ash::vk::FenceCreateFlags,
    bitflags::bitflags,
    bytemuck::{Pod, Zeroable},
    derive_more::Debug,
    glam::{vec3, vec4, Mat4, Vec2, Vec3, Vec4},
    std::{collections::HashMap, default, sync::Arc},
    tracing::instrument,
};
bitflags! {
    #[derive(Clone, Copy, Debug, Default)]
    pub struct RenderFlags: u32 {
            const DEBUG_COLOR           = 0b00000000_00000000_00000001;
            const DEBUG_NORMALS         = 0b00000000_00000000_00000010;
            const DEBUG_TANGENTS        = 0b00000000_00000000_00000100;
            const DEBUG_METALLIC        = 0b00000000_00000000_00001000;
            const DEBUG_ROUGHNESS       = 0b00000000_00000000_00010000;
            const DEBUG_OCCLUSION       = 0b00000000_00000000_00100000;
            const DEBUG_TEXCOORDS0      = 0b00000000_00000000_01000000;

            const DISABLE_COLOR_MAP     = 0b00000000_00000001_00000000;
            const DISABLE_NORMAL_MAP    = 0b00000000_00000010_00000000;
            const DISABLE_MR_MAP        = 0b00000000_00000100_00000000;
            const DISABLE_OCCLUSION_MAP = 0b00000000_00001000_00000000;
            const DISABLE_TANGENTS      = 0b00000000_00010000_00000000;

            const OVERRIDE_COLOR        = 0b00000001_00000000_00000000;
            const OVERRIDE_METAL        = 0b00000010_00000000_00000000;
            const OVERRIDE_ROUGH        = 0b00000100_00000000_00000000;
            const OVERRIDE_OCCLUSION    = 0b00001000_00000000_00000000;
            const OVERRIDE_LIGHTS       = 0b00010000_00000000_00000000;

    }
}

// Constants
const FORMAT_DRAW_IMAGE: Format = Format::R16G16B16A16_SFLOAT;
const FORMAT_DEPTH_IMAGE: Format = Format::D32_SFLOAT;
const SET_IDX_BINDLESS: usize = 0;
const BIND_IDX_CONFIG: usize = 0;
const BIND_IDX_SCENE: usize = 1;
const BIND_IDX_MATERIAL: usize = 2;
const BIND_IDX_TEXTURE: usize = 3;
const N_FRAMES: usize = 2;
const N_LIGHTS: usize = 4;

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuSceneData {
    pub view: Mat4,
    pub projection: Mat4,
    pub vp: Mat4,
    pub camera_pos: Vec3,
    pub n_lights: u32,
    pub lights: [Light; N_LIGHTS],
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuConfigData {
    pub flags: u32,
    pub override_metallic: f32,
    pub override_roughness: f32,
    pub override_occlusion: f32,
    pub override_color: Vec4,
    pub override_light0: Vec4,
    pub override_light1: Vec4,
    pub override_light2: Vec4,
    pub override_light3: Vec4,
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuObjectData {
    pub materials: [GpuMaterial; 32],
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuPushConstantData {
    pub model: Mat4,
    pub material_index: u32,
    pub _padding0: u32,
    pub _padding1: u32,
    pub _padding2: u32,
}

// Render Objects
#[derive(Debug)]
pub struct RenderObject {
    pub vertex_offset: usize,
    pub index_offset: usize,
    pub index_count: usize,
    pub material: usize,
    pub transform: Mat4,
}

// Frame and Context Structures
#[derive(Debug)]
pub struct Frame {
    #[debug("{:#x}", acquire_semaphore.as_raw())]
    pub acquire_semaphore: Semaphore,
    #[debug("{:#x}", present_semaphore.as_raw())]
    pub present_semaphore: Semaphore,
    #[allow(dead_code)]
    #[debug("{:#x}", fence.as_raw())]
    pub fence: Fence,
    #[debug("{:#x}", cmd_pool.handle().as_raw())]
    #[allow(dead_code)]
    pub cmd_pool: CommandPool,
    #[debug("{:#x}", cmd_buffer.handle().as_raw())]
    pub cmd_buffer: CommandBuffer,
}

impl Frame {
    pub fn new(gpu: &Gpu) -> Self {
        let cmd_pool = CommandPool::new(
            gpu.device(),
            gpu.device().graphics_queue(),
            &format!("frame-pool"),
        );
        let cmd_buffer = cmd_pool.create_command_buffer(&format!("frame-cmd"));

        let acquire_semaphore = gpu.device().create_semaphore();
        let present_semaphore = gpu.device().create_semaphore();
        let fence = gpu.device().create_fence(FenceCreateFlags::SIGNALED);

        Frame {
            cmd_pool,
            acquire_semaphore,
            present_semaphore,
            cmd_buffer,
            fence,
        }
    }
}

pub struct RenderContext<'a> {
    pub gpu: &'a Gpu,
    pub scene: &'a Scene,
    pub command_buffer: &'a CommandBuffer,
    pub scene_buffer: &'a TypedBuffer<GpuSceneData>,
    pub draw_image: &'a Texture,
    pub material_map: &'a HashMap<MaterialHandle, usize>,
    pub render_extent: Extent2D,
    pub depth_image: &'a Texture,
    pub objects: &'a Vec<RenderObject>,
    pub binder: &'a ResourceBinder,
    pub assets: &'a Assets,
}

// GPU resource bundle for Renderer
#[derive(Debug)]
pub struct RendererResources {
    pub scene_buffer: TypedBuffer<GpuSceneData>,
    pub scene_data: GpuSceneData,
    pub config_buffer: TypedBuffer<GpuConfigData>,
    pub config_data: GpuConfigData,
    pub object_data_buffer: TypedBuffer<GpuObjectData>,
    pub index_buffer: TypedBuffer<u32>,
    pub vertex_buffer: TypedBuffer<Vertex>,
    pub binder: ResourceBinder,
}

impl RendererResources {
    pub fn new(gpu: &Arc<Gpu>) -> Result<Self> {
        let scene_buffer = TypedBuffer::shared_uniform(gpu, 1, "renderer-scene")?;
        let scene_data = GpuSceneData {
            n_lights: 3,
            ..Default::default()
        };
        let config_buffer = TypedBuffer::shared_uniform(gpu, 1, "renderer-config")?;
        let object_data_buffer = TypedBuffer::shared_uniform(gpu, 1, "renderer-object")?;
        let index_buffer = TypedBuffer::index(gpu, 1, "renderer-index")?;
        let vertex_buffer = TypedBuffer::vertex(gpu, 1, "renderer-vertex")?;
        let config_data = GpuConfigData {
            flags: 0,
            ..Default::default()
        };

        // Create resource binder
        let binder = ResourceLayout::set(SET_IDX_BINDLESS)
            .uniform_buffer(BIND_IDX_CONFIG, ShaderStageFlags::ALL_GRAPHICS)
            .uniform_buffer(BIND_IDX_SCENE, ShaderStageFlags::ALL_GRAPHICS)
            .uniform_buffer(BIND_IDX_MATERIAL, ShaderStageFlags::ALL_GRAPHICS)
            .texture_array(BIND_IDX_TEXTURE, ShaderStageFlags::ALL_GRAPHICS)
            .finish(gpu)?;

        Ok(Self {
            scene_buffer,
            scene_data,
            config_buffer,
            object_data_buffer,
            config_data,
            index_buffer,
            vertex_buffer,
            binder,
        })
    }
}

// Main Renderer
#[derive(Debug)]
pub struct Renderer {
    #[debug("{}", self.frames.len())]
    frames: Vec<Frame>,
    #[debug(skip)]
    forward_pipeline: ForwardPipeline,
    rebuild_swapchain: bool,
    frame_idx: usize,
    pub extent: Extent2D,
    frame_counter: usize,
    last_scene_version: u64,

    pub draw_image: Texture,
    pub depth_image: Texture,

    // GPU resources
    resources: RendererResources,

    // Render data
    render_objects: Vec<RenderObject>,
    #[debug(skip)]
    material_map: HashMap<MaterialHandle, usize>,

    // State
    #[debug(skip)]
    pub gpu: Arc<Gpu>,
    config: RenderConfig,
}

impl Renderer {
    pub fn new(gpu: Arc<Gpu>) -> Result<Self> {
        let extent = gpu.swapchain().extent();
        let (draw_image, depth_image) = Self::create_attachments(&gpu, extent)?;
        let frames = Self::create_frames(&gpu);
        let resources = RendererResources::new(&gpu)?;
        let forward_pipeline = ForwardPipeline::new(
            &gpu,
            &resources.binder.descriptor_layout(),
            &draw_image,
            &depth_image,
        )?;

        Ok(Self {
            gpu,
            frames,
            forward_pipeline,
            resources,
            rebuild_swapchain: false,
            frame_idx: 0,
            draw_image,
            depth_image,
            extent,
            frame_counter: 0,
            render_objects: Vec::new(),
            material_map: HashMap::new(),
            last_scene_version: 0,
            config: RenderConfig::default(),
        })
    }

    fn create_frames(gpu: &Arc<Gpu>) -> Vec<Frame> {
        (0..N_FRAMES).map(|_| Frame::new(&gpu)).collect::<Vec<Frame>>()
    }
    fn update_per_frame_data(&mut self, scene: &Scene, _assets: &Assets) {
        let view = scene.camera.view();
        let projection = scene.camera.projection();

        self.resources.scene_data.view = view;
        self.resources.scene_data.projection = projection;
        self.resources.scene_data.vp = projection * view.inverse();
        self.resources.scene_data.camera_pos = scene.camera.position();
        self.resources.scene_buffer.write(&[self.resources.scene_data]);

        self.resources.config_buffer.write(&[self.resources.config_data]);
    }

    #[instrument(skip_all)]
    pub fn render(
        &mut self,
        scene: &Scene,
        assets: &mut Assets,
        gui: &mut Gui,
        // window_extent: Extent2D,
    ) -> Result<()> {
        self.update_per_frame_data(scene, assets);

        if scene.version() > self.last_scene_version {
            self.last_scene_version = scene.version();
            self.prepare_bindless(assets, scene)?;
        }

        if self.rebuild_swapchain {
            let extent = self.gpu.swapchain().extent();
            self.rebuild_swapchain(extent);
        }

        let Frame {
            acquire_semaphore,
            cmd_buffer,
            present_semaphore,
            ..
        } = &self.frames[self.frame_idx];

        let (next_image_index, rebuild_swapchain) =
            self.gpu.swapchain().acquire_next_image(*acquire_semaphore)?;
        self.rebuild_swapchain = rebuild_swapchain;
        let swapchain_image = {
            let swapchain = self.gpu.swapchain();
            &swapchain.images()[next_image_index]
        };

        cmd_buffer.reset();
        cmd_buffer.begin();
        cmd_buffer.bind_index_buffer(&*self.resources.index_buffer, 0);
        cmd_buffer.bind_vertex_buffer(&self.resources.vertex_buffer, 0);

        cmd_buffer.pipeline_barrier(
            &[],
            &[],
            &[sync::image_memory_barrier(
                &self.draw_image,
                PipelineStageFlags2::TOP_OF_PIPE,
                AccessFlags2::NONE,
                PipelineStageFlags2::COLOR_ATTACHMENT_OUTPUT,
                AccessFlags2::COLOR_ATTACHMENT_WRITE,
                ImageLayout::UNDEFINED,
                ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
            )],
        );

        cmd_buffer.pipeline_barrier(
            &[],
            &[],
            &[sync::image_memory_barrier(
                &self.depth_image,
                PipelineStageFlags2::TOP_OF_PIPE,
                AccessFlags2::NONE,
                PipelineStageFlags2::EARLY_FRAGMENT_TESTS
                    | PipelineStageFlags2::LATE_FRAGMENT_TESTS,
                AccessFlags2::DEPTH_STENCIL_ATTACHMENT_READ
                    | AccessFlags2::DEPTH_STENCIL_ATTACHMENT_WRITE,
                ImageLayout::UNDEFINED,
                ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
            )],
        );

        let context = RenderContext {
            gpu: &self.gpu,
            command_buffer: &cmd_buffer,
            scene_buffer: &self.resources.scene_buffer,
            draw_image: &self.draw_image,
            depth_image: &self.depth_image,
            render_extent: self.extent,
            material_map: &self.material_map,
            binder: &self.resources.binder,
            scene,
            objects: &self.render_objects,
            assets,
        };

        self.forward_pipeline.render(&context, &cmd_buffer)?;
        gui.draw(&context, &mut self.resources.config_data)?;

        cmd_buffer.pipeline_barrier(
            &[],
            &[],
            &[sync::image_memory_barrier(
                &self.draw_image,
                PipelineStageFlags2::COLOR_ATTACHMENT_OUTPUT,
                AccessFlags2::COLOR_ATTACHMENT_WRITE,
                PipelineStageFlags2::TRANSFER,
                AccessFlags2::TRANSFER_READ,
                ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
                ImageLayout::TRANSFER_SRC_OPTIMAL,
            )],
        );

        cmd_buffer.pipeline_barrier(
            &[],
            &[],
            &[sync::image_memory_barrier(
                &swapchain_image,
                PipelineStageFlags2::TOP_OF_PIPE,
                AccessFlags2::NONE,
                PipelineStageFlags2::TRANSFER,
                AccessFlags2::TRANSFER_WRITE,
                ImageLayout::UNDEFINED,
                ImageLayout::TRANSFER_DST_OPTIMAL,
            )],
        );

        cmd_buffer.copy_image(
            &self.draw_image,
            swapchain_image,
            self.draw_image.extent().into(),
            swapchain_image.extent().into(),
        );
        cmd_buffer.pipeline_barrier(
            &[],
            &[],
            &[sync::image_memory_barrier(
                &swapchain_image,
                PipelineStageFlags2::TRANSFER,
                AccessFlags2::TRANSFER_WRITE,
                PipelineStageFlags2::BOTTOM_OF_PIPE,
                AccessFlags2::NONE,
                ImageLayout::TRANSFER_DST_OPTIMAL,
                ImageLayout::PRESENT_SRC_KHR,
            )],
        );
        cmd_buffer.end();

        self.gpu.queue_submit(
            &self.gpu.device().graphics_queue(),
            &[cmd_buffer],
            &[(*acquire_semaphore, PipelineStageFlags2::ALL_COMMANDS)],
            &[(*present_semaphore, PipelineStageFlags2::ALL_COMMANDS)],
            Fence::null(),
        );
        self.gpu.device().wait_idle();

        let rebuild_swapchain = self.gpu.swapchain().present(
            self.gpu.device().graphics_queue(),
            &[*present_semaphore],
            &[next_image_index as u32],
        )?;

        self.frame_counter += 1;
        self.frame_idx = self.frame_counter % self.frames.len();
        self.rebuild_swapchain |= rebuild_swapchain;

        Ok(())
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        log::debug!("Resizing renderer to {}x{}", width, height);
        let extent = Extent2D { width, height };
        self.rebuild_swapchain(extent);
    }

    pub fn rebuild_swapchain(&mut self, extent: Extent2D) {
        log::debug!("Rebuilding swapchain with extent: {:?}", extent);

        self.extent = extent;
        self.gpu.rebuild_swapchain(extent);
        self.frames = Self::create_frames(&self.gpu);
        let (draw_image, depth_image) = Self::create_attachments(&self.gpu, extent).unwrap();
        self.draw_image = draw_image;
        self.depth_image = depth_image;
        self.forward_pipeline = ForwardPipeline::new(
            &self.gpu,
            &self.resources.binder.descriptor_layout(),
            &self.draw_image,
            &self.depth_image,
        )
        .unwrap();
        self.rebuild_swapchain = false;
    }

    fn create_render_objects2(
        &self,
        meshes: &Vec<(MeshHandle, Mat4)>,
        data: &BindlessData,
    ) -> Result<(Vec<RenderObject>, TypedBuffer<Vertex>, TypedBuffer<u32>)> {
        let mut objects = vec![];
        let mut all_vertices = vec![];
        let mut all_indices = vec![];

        for (handle, transform) in meshes.iter() {
            let index = data.mesh_map.get(handle).unwrap();
            let mesh = data.meshes.get(*index).unwrap();

            let vertex_offset = all_vertices.len();
            let index_offset = all_indices.len();
            let index_count = mesh.indices.len();

            // Create vertices
            let mesh_vertices = (0..mesh.vertices.len())
                .map(|i| Vertex {
                    position: mesh.vertices[i],
                    normal: *mesh.normals.get(i).unwrap_or(&Vec3::ONE),
                    tangent: *mesh.tangents.get(i).unwrap_or(&Vec4::ZERO),
                    color: *mesh.colors.get(i).unwrap_or(&Vec4::ONE),
                    uv_x: mesh.tex_coords0.get(i).unwrap_or(&Vec2::ZERO)[0],
                    uv_y: mesh.tex_coords0.get(i).unwrap_or(&Vec2::ZERO)[1],
                })
                .collect::<Vec<_>>();

            // Create indices with vertex offset
            let mesh_indices =
                mesh.indices.iter().map(|&idx| idx + vertex_offset as u32).collect::<Vec<_>>();

            all_vertices.extend(mesh_vertices);
            all_indices.extend(mesh_indices);

            let material = *data.material_map.get(&mesh.material).unwrap_or(&0);

            objects.push(RenderObject {
                vertex_offset,
                index_offset,
                index_count,
                transform: *transform,
                material,
            });
        }

        // Create and populate buffers
        let vertex_buffer = TypedBuffer::vertex(&self.gpu, all_vertices.len(), "shared_vertices")?;
        let index_buffer = TypedBuffer::index(&self.gpu, all_indices.len(), "shared_indices")?;

        vertex_buffer.write(bytemuck::cast_slice(&all_vertices));
        index_buffer.write(bytemuck::cast_slice(&all_indices));

        Ok((objects, vertex_buffer, index_buffer))
    }

    #[instrument(skip_all)]
    pub fn prepare_bindless(&mut self, assets: &mut Assets, scene: &Scene) -> Result<()> {
        let cmd = &self.gpu.immediate_cmd_buffer();
        cmd.begin();

        let bindless_data = assets.prepare_bindless(cmd)?;

        // Prepare materials
        let mut materials_arr = [GpuMaterial::default(); 32];
        for (i, material) in bindless_data.materials.iter().enumerate() {
            materials_arr[i] = *material;
        }
        let object_data = GpuObjectData {
            materials: materials_arr,
        };

        // Create render objects
        let mesh_nodes = scene
            .mesh_nodes()
            .map(|node| match node.data {
                NodeData::Mesh(handle) => (handle, node.world_transform),
                _ => panic!("Should not be here, node: {:?}", node),
            })
            .collect::<Vec<_>>();

        let (render_objects, vertex_buffer, index_buffer) =
            self.create_render_objects2(&mesh_nodes, &bindless_data)?;

        self.render_objects = render_objects;
        self.resources.index_buffer = index_buffer;
        self.resources.vertex_buffer = vertex_buffer;
        self.resources.object_data_buffer.write(&[object_data]);

        // Update bindings
        self.resources
            .binder
            .uniform_buffer(BIND_IDX_CONFIG, &self.resources.config_buffer, 0)
            .uniform_buffer(BIND_IDX_SCENE, &self.resources.scene_buffer, 0)
            .uniform_buffer(BIND_IDX_MATERIAL, &self.resources.object_data_buffer, 0)
            .texture_array(
                BIND_IDX_TEXTURE,
                &bindless_data.textures,
                &assets.default_sampler(),
            )
            .update(&self.gpu)?;

        cmd.end();

        self.gpu.queue_submit(
            &self.gpu.device().graphics_queue(),
            &[cmd],
            &[],
            &[],
            Fence::null(),
        );

        self.gpu.device().wait_idle();
        Ok(())
    }

    pub fn create_attachments(gpu: &Gpu, extent: Extent2D) -> Result<(Texture, Texture)> {
        let draw_info = TextureInfo {
            name: "draw".to_string(),
            extent,
            format: FORMAT_DRAW_IMAGE,
            flags: ImageUsageFlags::COLOR_ATTACHMENT
                | ImageUsageFlags::TRANSFER_DST
                | ImageUsageFlags::TRANSFER_SRC,
            aspect_flags: ImageAspectFlags::COLOR,
            sampler: None,
        };
        let depth_info = TextureInfo {
            name: "depth".to_string(),
            extent,
            format: FORMAT_DEPTH_IMAGE,
            flags: ImageUsageFlags::DEPTH_STENCIL_ATTACHMENT
                | ImageUsageFlags::TRANSFER_DST
                | ImageUsageFlags::TRANSFER_SRC,
            aspect_flags: ImageAspectFlags::DEPTH,
            sampler: None,
        };

        let draw_image = Texture::new(gpu, &draw_info)?;
        let depth_image = Texture::new(gpu, &depth_info)?;

        Ok((draw_image, depth_image))
    }
}

#[derive(Default, Debug, Clone, Copy)]
pub struct RenderConfig {
    pub color_factor: Option<Vec4>,
    pub metal_factor: Option<f32>,
    pub rough_factor: Option<f32>,
    pub occlusion_strength: Option<f32>,
    pub default_color_map: bool,
    pub default_normal_map: bool,
    pub default_metalrough_map: bool,
    pub default_occlusion_map: bool,
    pub output_override: RenderOutputOverride,
}

#[derive(Default, Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenderOutputOverride {
    #[default]
    None,
    Color,
    Normals,
    Tangents,
    MetalRough,
    Occlusion,
    TexCoords0,
}

fn apply_overrides(material: Material, config: &RenderConfig, assets: &Assets) -> Material {
    let default = assets.default_material();
    let mut material = Material::default();

    material.color_factor = match config.color_factor {
        Some(value) => value,
        None => material.color_factor,
    };
    material.metallic_factor = match config.metal_factor {
        Some(value) => value,
        None => material.metallic_factor,
    };
    material.roughness_factor = match config.rough_factor {
        Some(value) => value,
        None => material.roughness_factor,
    };
    material.occlusion_strength = match config.occlusion_strength {
        Some(value) => value,
        None => material.occlusion_strength,
    };

    material.color_texture = match config.default_color_map {
        true => default.color_texture,
        false => material.color_texture,
    };
    material.normal_texture = match config.default_normal_map {
        true => default.normal_texture,
        false => material.normal_texture,
    };
    material.metalrough_texture = match config.default_metalrough_map {
        true => default.metalrough_texture,
        false => material.metalrough_texture,
    };
    material.occlusion_texture = match config.default_occlusion_map {
        true => default.occlusion_texture,
        false => material.occlusion_texture,
    };

    material
}
