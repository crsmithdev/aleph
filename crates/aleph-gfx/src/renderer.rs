use {
    crate::{ForwardPipeline, Gui, Pipeline, ResourceBinder, ResourceLayout},
    aleph_scene::{
        assets::{BindlessData, GpuMaterial},
        model::Light,
        Assets, MaterialHandle, MeshHandle, NodeType, Scene, Vertex,
    },
    aleph_vk::{
        sync, AccessFlags2, CommandBuffer, CommandPool, Extent2D, Extent3D, Fence, Format, Gpu,
        Handle as _, ImageAspectFlags, ImageLayout, ImageUsageFlags, PipelineStageFlags2,
        Semaphore, ShaderStageFlags, Texture, TextureInfo, TypedBuffer,
    },
    anyhow::Result,
    ash::vk::FenceCreateFlags,
    bytemuck::{Pod, Zeroable},
    derive_more::Debug,
    glam::{vec3, vec4, Mat4, Vec2, Vec3, Vec4},
    std::{collections::HashMap, panic, sync::Arc},
    tracing::instrument,
};

const FORMAT_DRAW_IMAGE: Format = Format::R16G16B16A16_SFLOAT;
const FORMAT_DEPTH_IMAGE: Format = Format::D32_SFLOAT;
const SET_IDX_BINDLESS: usize = 0;
const BIND_IDX_SCENE: usize = 0;
const BIND_IDX_MATERIAL: usize = 1;
const BIND_IDX_TEXTURE: usize = 2;
const N_FRAMES: usize = 2;

const LIGHTS: [Light; 4] = [
    Light {
        position: vec3(2., 2., 2.),
        color: vec4(10., 10., 10., 10.),
        intensity: 10.,
    },
    Light {
        position: vec3(-2., -2., -2.),
        color: vec4(10., 10., 10., 10.),
        intensity: 10.,
    },
    Light {
        position: vec3(-2., 2., 2.),
        color: vec4(10., 10., 10., 10.),
        intensity: 10.,
    },
    Light {
        position: vec3(2., -2., -2.),
        color: vec4(10., 10., 10., 10.),
        intensity: 10.,
    },
];

#[derive(Debug)]
pub struct Renderer {
    #[debug("{}", self.frames.len())]
    frames: Vec<Frame>,
    #[debug(skip)]
    forward_pipeline: ForwardPipeline,
    rebuild_swapchain: bool,
    frame_idx: usize,
    frame_counter: usize,
    draw_image: Texture,
    depth_image: Texture,
    #[debug(skip)]
    material_map: HashMap<MaterialHandle, usize>,
    scene_buffer: TypedBuffer<GpuSceneData>,
    #[debug(skip)]
    scene_data: GpuSceneData,
    object_data_buffer: TypedBuffer<GpuObjectData>,
    render_objects: Vec<RenderObject>,
    #[debug(skip)]
    binder: ResourceBinder,
    #[debug(skip)]
    pub gpu: Arc<Gpu>,
    pub prepared: bool,
    #[debug(skip)]
    config: RenderConfig,
}

impl From<&RenderConfig> for GpuConfig {
    fn from(config: &RenderConfig) -> Self {
        Self {
            force_color: config.force_color as i32,
            force_metallic: config.force_metallic as i32,
            force_roughness: config.force_roughness as i32,
            force_ao: config.force_ao as i32,
            force_color_factor: config.force_color_factor,
            force_metallic_factor: config.force_metallic_factor,
            force_roughness_factor: config.force_roughness_factor,
            force_ao_strength: config.force_ao_strength,
            debug_normals: config.debug_normals as i32,
            debug_tangents: config.debug_tangents as i32,
            debug_bitangents: config.debug_bitangents as i32,
            debug_specular: config.debug_specular as i32,
            debug_normal_maps: config.debug_normal_maps as i32,
            force_defaults: 0,
            _padding0: Vec3::ZERO,
        }
    }
}
pub struct RenderConfig {
    pub force_color: bool,
    pub force_metallic: bool,
    pub force_roughness: bool,
    pub force_ao: bool,
    pub force_color_factor: Vec4,
    pub force_metallic_factor: f32,
    pub force_roughness_factor: f32,
    pub force_ao_strength: f32,
    pub debug_normals: bool,
    pub debug_tangents: bool,
    pub debug_bitangents: bool,
    pub debug_specular: bool,
    pub debug_normal_maps: bool,
    pub force_defaults: bool,
}

impl Renderer {
    pub fn new(gpu: Arc<Gpu>) -> Result<Self> {
        let extent = gpu.swapchain().extent().into();
        let frames = Self::create_frames(&gpu)?;
        let draw_info = TextureInfo {
            name: "draw".to_string(),
            extent: extent,
            format: FORMAT_DRAW_IMAGE,
            flags: ImageUsageFlags::COLOR_ATTACHMENT
                | ImageUsageFlags::TRANSFER_DST
                | ImageUsageFlags::TRANSFER_SRC,
            aspect_flags: ImageAspectFlags::COLOR,
            sampler: None,
        };
        let draw_image = Texture::new(&gpu, &draw_info)?;

        let depth_info = TextureInfo {
            name: "depth".to_string(),
            extent: extent,
            format: FORMAT_DEPTH_IMAGE,
            flags: ImageUsageFlags::DEPTH_STENCIL_ATTACHMENT
                | ImageUsageFlags::TRANSFER_DST
                | ImageUsageFlags::TRANSFER_SRC,
            aspect_flags: ImageAspectFlags::DEPTH,
            sampler: None,
        };
        let depth_image = Texture::new(&gpu, &depth_info)?;

        let scene_buffer = TypedBuffer::shared_uniform(&gpu, 1, "renderer-scene")?;
        let object_data_buffer = TypedBuffer::shared_uniform(&gpu, 1, "renderer-objects")?;

        let binder = ResourceLayout::set(SET_IDX_BINDLESS)
            .uniform_buffer(BIND_IDX_SCENE, ShaderStageFlags::ALL_GRAPHICS)
            .uniform_buffer(BIND_IDX_MATERIAL, ShaderStageFlags::ALL_GRAPHICS)
            .texture_array(BIND_IDX_TEXTURE, ShaderStageFlags::ALL_GRAPHICS)
            .finish(&gpu)?;

        let foreward_pipeline =
            ForwardPipeline::new(&gpu, &binder.descriptor_layout(), &draw_image, &depth_image)?;
        let scene_data = GpuSceneData {
            lights: LIGHTS,
            n_lights: 3,
            ..Default::default()
        };

        Ok(Self {
            gpu,
            frames,
            forward_pipeline: foreward_pipeline,
            draw_image,
            depth_image,
            scene_data,
            scene_buffer,
            rebuild_swapchain: false,
            frame_idx: 0,
            frame_counter: 0,
            render_objects: Vec::new(),
            config: RenderConfig {
                force_color: false,
                force_metallic: false,
                force_roughness: false,
                force_ao: false,
                force_color_factor: Vec4::ZERO,
                force_metallic_factor: 0.0,
                force_roughness_factor: 0.0,
                force_ao_strength: 0.0,
                debug_normals: false,
                debug_tangents: false,
                debug_bitangents: false,
                debug_specular: false,
                debug_normal_maps: false,
                force_defaults: false,
            },
            material_map: HashMap::new(),
            object_data_buffer,
            binder,
            prepared: false,
        })
    }

    fn update_per_frame_data(&mut self, scene: &Scene, _assets: &Assets) {
        let view = scene.camera.view();
        let projection = scene.camera.projection();

        let mut scene_data = self.scene_data.clone();
        scene_data.view = view;
        scene_data.projection = projection;
        scene_data.vp = projection * view.inverse();
        scene_data.camera_pos = scene.camera.position();

        let scene_data = GpuSceneData {
            view,
            projection,
            vp: projection * view.inverse(),
            camera_pos: scene.camera.position(),
            n_lights: LIGHTS.len() as i32,
            config: GpuConfig::from(&self.config),
            lights: LIGHTS,
        };
        self.scene_buffer.write(&[self.scene_data]);
        self.scene_data = scene_data;
    }

    #[instrument(skip_all)]
    pub fn render(
        &mut self,
        scene: &Scene,
        assets: &mut Assets,
        gui: &mut Gui,
        extent: Extent2D,
    ) -> Result<()> {
        self.update_per_frame_data(scene, assets);

        if self.rebuild_swapchain {
            self.gpu.rebuild_swapchain(extent);
            self.frames = Self::create_frames(&self.gpu)?;
            self.rebuild_swapchain = false;
        }

        let Frame {
            acquire_semaphore,
            cmd_buffer,
            present_semaphore,
            fence,
            ..
        } = &self.frames[self.frame_idx];
        log::trace!(
            "START FRAME {}@{}: aq, pr semaphores: [{:#x}, {:#x}], fence: {:?}, cmd: {:?}",
            self.frame_counter,
            self.frame_idx,
            acquire_semaphore.as_raw(),
            present_semaphore.as_raw(),
            fence,
            cmd_buffer
        );

        // self.gpu.device().wait_for_fences(&[*fence]);
        let (next_idx, rebuild_swapchain) =
            self.gpu.swapchain().acquire_next_image(*acquire_semaphore)?;
        self.rebuild_swapchain = rebuild_swapchain;
        // self.gpu.reset_fence(*fence)?;

        let draw_image = &self.draw_image;
        let depth_image = &self.depth_image;
        let (swapchain_image, swapchain_extent) = {
            let swapchain = self.gpu.swapchain();
            (&swapchain.images()[next_idx], swapchain.extent())
        };
        let render_extent = Extent3D {
            width: self.draw_image.extent().width.min(swapchain_extent.width),
            height: self.draw_image.extent().height.min(swapchain_extent.height),
            depth: 1,
        };

        cmd_buffer.reset();
        cmd_buffer.begin();

        cmd_buffer.pipeline_barrier(
            &[],
            &[],
            &[sync::image_memory_barrier(
                &draw_image,
                PipelineStageFlags2::TOP_OF_PIPE, // No previous usage
                AccessFlags2::NONE,               // No previous access
                PipelineStageFlags2::COLOR_ATTACHMENT_OUTPUT, // Will be used as color attachment
                AccessFlags2::COLOR_ATTACHMENT_WRITE, // Will write color data
                ImageLayout::UNDEFINED,
                ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
            )],
        );

        // Initial transition: UNDEFINED -> DEPTH_STENCIL_ATTACHMENT_OPTIMAL
        cmd_buffer.pipeline_barrier(
            &[],
            &[],
            &[sync::image_memory_barrier(
                &depth_image,
                PipelineStageFlags2::TOP_OF_PIPE, // No previous usage
                AccessFlags2::NONE,               // No previous access
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
            scene_buffer: &self.scene_buffer,
            draw_image: &self.draw_image,
            depth_image: &self.depth_image,
            render_extent: swapchain_extent,
            material_map: &self.material_map,
            binder: &self.binder,
            scene,
            objects: &self.render_objects,
            assets,
        };
        self.forward_pipeline.render(&context, &cmd_buffer)?;
        gui.draw(&context, &mut self.config, &mut self.scene_data)?;
        self.gpu.device().wait_idle();
        self.gpu.debug_utils().begin_debug_label(&cmd_buffer, "blit to swapchain");

        cmd_buffer.pipeline_barrier(
            &[],
            &[],
            &[sync::image_memory_barrier(
                &draw_image,
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
            &draw_image,
            &swapchain_image,
            render_extent,
            swapchain_extent.into(),
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
        self.gpu.debug_utils().end_debug_label(&cmd_buffer);
        cmd_buffer.end();

        log::trace!("WAIT @ render queue submit");
        self.gpu.device().wait_idle();
        self.gpu.device().queue_submit(
            &self.gpu.device().graphics_queue(),
            &[cmd_buffer.handle()],
            &[(*acquire_semaphore, PipelineStageFlags2::ALL_COMMANDS)],
            &[(*present_semaphore, PipelineStageFlags2::ALL_COMMANDS)],
            // *fence,
            Fence::null(),
        );
        self.gpu.device().wait_idle();

        let rebuild_swapchain = self.gpu.swapchain().present(
            self.gpu.device().graphics_queue(),
            &[*present_semaphore],
            &[next_idx as u32],
        )?;
        log::trace!(
            "END FRAME {}@{}: aq, pr semaphores: [{:#x}, {:#x}], fence: {:?}, cmd: {:?}",
            self.frame_counter,
            self.frame_idx,
            acquire_semaphore.as_raw(),
            present_semaphore.as_raw(),
            fence,
            cmd_buffer
        );

        self.frame_counter += 1;
        self.frame_idx = self.frame_counter % self.frames.len() as usize;
        self.rebuild_swapchain |= rebuild_swapchain;

        Ok(())
    }

    fn create_render_objects<'a>(
        &self,
        transforms: &Vec<(MeshHandle, Mat4)>,
        data: &BindlessData,
    ) -> Result<Vec<RenderObject>> {
        let mut objects = vec![];
        for (handle, transform) in transforms.iter() {
            let index = data.mesh_map.get(handle).unwrap();
            let mesh = data.meshes.get(*index).unwrap();
            let mut index_buffer = TypedBuffer::index(&self.gpu, mesh.indices.len(), "index")?;
            let mut vertex_buffer = TypedBuffer::vertex(&self.gpu, mesh.vertices.len(), "vertex")?;
            let vertex_count = mesh.vertices.len();
            let vertices = (0..vertex_count)
                .map(|i| Vertex {
                    position: mesh.vertices[i],
                    normal: *mesh.normals.get(i).unwrap_or(&Vec3::ONE),
                    tangent: *mesh.tangents.get(i).unwrap_or(&Vec4::ONE),
                    color: *mesh.colors.get(i).unwrap_or(&Vec4::ONE),
                    uv_x: mesh.tex_coords0.get(i).unwrap_or(&Vec2::ZERO)[0],
                    uv_y: mesh.tex_coords0.get(i).unwrap_or(&Vec2::ZERO)[1],
                })
                .collect::<Vec<_>>();

            let index_data = bytemuck::cast_slice(&mesh.indices);
            index_buffer.write(index_data);

            let vertex_data = bytemuck::cast_slice(&vertices);
            vertex_buffer.write(vertex_data);

            let material = *data.material_map.get(&mesh.material).unwrap_or(&0);

            objects.push(RenderObject {
                vertex_buffer,
                vertex_count,
                index_buffer,
                transform: *transform,
                material,
            });
        }

        Ok(objects)
    }

    #[instrument(skip_all)]
    pub fn prepare_bindless(&mut self, assets: &mut Assets, scene: &Scene) -> Result<()> {
        log::trace!("WAIT @ start of prepare bindless");
        self.gpu.device().wait_idle();
        let cmd = &self.gpu.immediate_cmd_buffer();
        cmd.begin();

        let bindless_data = assets.prepare_bindless(cmd)?;

        let mut materials_arr = [
            GpuMaterial::default(),
            GpuMaterial::default(),
            GpuMaterial::default(),
            GpuMaterial::default(),
            GpuMaterial::default(),
            GpuMaterial::default(),
            GpuMaterial::default(),
            GpuMaterial::default(),
            GpuMaterial::default(),
            GpuMaterial::default(),
        ];
        for (i, material) in bindless_data.materials.iter().enumerate() {
            materials_arr[i] = *material;
        }
        let object_data = GpuObjectData {
            materials: materials_arr,
        };
        let mesh_nodes = scene
            .mesh_nodes()
            .map(|node| match node.data {
                NodeType::Mesh(handle) => (handle, node.transform),
                _ => panic!("Should not be here, node: {:?}", node),
            })
            .collect::<Vec<_>>();
        self.render_objects = self.create_render_objects(&mesh_nodes, &bindless_data)?;
        self.object_data_buffer.write(&[object_data]);
        self.binder
            .uniform_buffer(BIND_IDX_SCENE, &self.scene_buffer, 0)
            .uniform_buffer(BIND_IDX_MATERIAL, &self.object_data_buffer, 0)
            .texture_array(
                BIND_IDX_TEXTURE,
                &bindless_data.textures,
                assets.default_sampler(),
            )
            .update(&self.gpu)?;
        cmd.end();

        self.gpu.device().queue_submit(
            &self.gpu.device().graphics_queue(),
            &[***cmd],
            &[],
            &[],
            Fence::null(),
        );

        log::trace!("WAIT @ end of prepare bindless");
        self.gpu.device().wait_idle();

        Ok(())
    }

    fn create_frames(gpu: &Gpu) -> Result<Vec<Frame>> {
        let mut frames = Vec::new();
        for i in 0..N_FRAMES {
            let queue = gpu.device().graphics_queue();
            let name = format!("frame{i:02}");
            let cmd_pool = gpu.device().create_command_pool(queue, &name);
            let swapchain_semaphore = gpu.device().create_semaphore();
            let render_semaphore = gpu.device().create_semaphore();
            let fence = gpu.device().create_fence(FenceCreateFlags::SIGNALED);
            let cmd_buffer = cmd_pool.create_command_buffer(&name);

            frames.push(Frame {
                cmd_pool,
                acquire_semaphore: swapchain_semaphore,
                present_semaphore: render_semaphore,
                cmd_buffer,
                fence,
            });
        }
        Ok(frames)
    }
}

#[repr(C)]
#[derive(Debug, Default, Clone, Copy, Pod, Zeroable)]
pub struct GpuConfig {
    pub force_color: i32,
    pub force_metallic: i32,
    pub force_roughness: i32,
    pub force_ao: i32,
    pub force_color_factor: Vec4,
    pub force_metallic_factor: f32,
    pub force_roughness_factor: f32,
    pub force_ao_strength: f32,
    pub debug_normals: i32,
    pub debug_tangents: i32,
    pub debug_bitangents: i32,
    pub debug_specular: i32,
    pub debug_normal_maps: i32,
    pub force_defaults: i32,
    pub _padding0: Vec3,
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuSceneData {
    pub view: Mat4,
    pub projection: Mat4,
    pub vp: Mat4,
    pub camera_pos: Vec3,
    pub n_lights: i32,
    pub config: GpuConfig,
    pub lights: [Light; 4],
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuObjectData {
    pub materials: [GpuMaterial; 10],
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuPushConstantData {
    pub model: Mat4,
    pub material_index: i32,
    pub _padding0: i32,
    pub _padding1: i32,
    pub _padding2: i32,
}

#[derive(Debug)]
pub struct Frame {
    #[debug("{:#x}", acquire_semaphore.as_raw())]
    pub acquire_semaphore: Semaphore,
    #[debug("{:#x}", present_semaphore.as_raw())]
    pub present_semaphore: Semaphore,
    #[debug("{:#x}", fence.as_raw())]
    pub fence: Fence,
    #[debug("{:#x}", cmd_pool.handle().as_raw())]
    pub cmd_pool: CommandPool,
    #[debug("{:#x}", cmd_buffer.handle().as_raw())]
    pub cmd_buffer: CommandBuffer,
}

pub struct RenderContext<'a> {
    pub gpu: &'a Gpu,
    pub scene: &'a Scene,
    pub command_buffer: &'a CommandBuffer,
    pub scene_buffer: &'a TypedBuffer<GpuSceneData>,
    pub draw_image: &'a Texture,
    pub render_extent: Extent2D,
    pub material_map: &'a HashMap<MaterialHandle, usize>,
    pub depth_image: &'a Texture,
    pub objects: &'a Vec<RenderObject>,
    pub binder: &'a ResourceBinder,
    pub assets: &'a Assets,
}

#[derive(Debug)]
pub struct RenderObject {
    pub vertex_buffer: TypedBuffer<Vertex>,
    pub index_buffer: TypedBuffer<u32>,
    pub vertex_count: usize,
    pub material: usize,
    pub transform: Mat4,
}
