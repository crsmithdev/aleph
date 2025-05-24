use {
    crate::{ForwardPipeline, Gui, Pipeline, ResourceBinder, ResourceLayout},
    aleph_scene::{
        assets::GpuMaterialData, model::Light, Assets, MaterialHandle, Mesh, NodeType, Scene,
        TextureHandle,
    },
    aleph_vk::{
        debug,
        swapchain::{self, IN_FLIGHT_FRAMES},
        sync, AccessFlags2, CommandBuffer, CommandBufferSubmitInfo, CommandPool, Extent2D,
        Extent3D, Fence, Format, Gpu, Handle as _, ImageAspectFlags, ImageLayout, ImageUsageFlags,
        PipelineStageFlags2, Semaphore, SemaphoreSubmitInfo, ShaderStageFlags, SubmitInfo2,
        Texture, TextureInfo, TypedBuffer,
    },
    anyhow::Result,
    ash::vk::FenceCreateFlags,
    bytemuck::{Pod, Zeroable},
    derive_more::Debug,
    glam::{vec3, vec4, Mat4, Vec3, Vec4},
    std::{collections::HashMap, rc::Rc, sync::Arc},
    tracing::instrument,
};

pub struct RenderContext<'a> {
    pub gpu: &'a Gpu,
    pub scene: &'a Scene,
    pub command_buffer: &'a CommandBuffer,
    pub scene_buffer: &'a TypedBuffer<GpuSceneData>,
    pub draw_image: &'a Texture,
    pub render_extent: Extent2D,
    pub material_map: &'a HashMap<MaterialHandle, usize>,
    pub depth_image: &'a Texture,
    pub objects: &'a [RenderObject],
    pub binder: &'a ResourceBinder,
    pub assets: &'a Assets,
}

#[derive(Debug)]
pub struct RenderObject {
    pub mesh: Rc<Mesh>,
    pub vertex_count: usize,
    pub material: usize,
    pub transform: Mat4,
}

const FORMAT_DRAW_IMAGE: Format = Format::R16G16B16A16_SFLOAT;
const FORMAT_DEPTH_IMAGE: Format = Format::D32_SFLOAT;
const SET_IDX_BINDLESS: usize = 0;
const BIND_IDX_SCENE: usize = 0;
const BIND_IDX_MATERIAL: usize = 1;
const BIND_IDX_TEXTURE: usize = 2;

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
    material_buffer: TypedBuffer<GpuMaterialData>,
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
            data: vec![],
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
            data: vec![],
            sampler: None,
        };
        let depth_image = Texture::new(&gpu, &depth_info)?;

        let scene_buffer = TypedBuffer::shared_uniform(&gpu, 1, "renderer-scene")?;
        let material_buffer = TypedBuffer::shared_uniform(&gpu, 10, "renderer-material")?;

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
            material_buffer,
            binder,
            prepared: false,
        })
    }

    fn update_per_frame_data(&mut self, scene: &Scene, assets: &Assets) {
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
        // self.scene_data.view = view;
        // self.scene_data.projection = projection;
        // self.scene_data.vp = projection * view.inverse();
        // self.scene_data.camera_pos = scene.camera.position();
        // self.scene_data.config = GpuConfig::from(&self.config);
        self.scene_buffer.write(&[self.scene_data]);
        self.scene_data = scene_data;

        // self.create_render_objects2(scene, assets);
    }

    #[instrument(skip_all)]
    pub fn render(
        &mut self,
        scene: &Scene,
        assets: &mut Assets,
        _gui: &mut Gui,
        extent: Extent2D,
    ) -> Result<()> {
        log::trace!("ENTER render");
        self.update_per_frame_data(scene, assets);
        // self.create_render_objects2(scene, assets);

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
        log::trace!("WAIT @ render start");
        self.gpu.device().wait_idle();
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
        let (next_idx, rebuild_swapchain) = self
            .gpu
            .swapchain()
            .acquire_next_image(*acquire_semaphore)?;
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

        // let barrier = sync::memory_barrier(
        //     PipelineStageFlags2::TRANSFER,
        //     AccessFlags2::MEMORY_WRITE,
        //     PipelineStageFlags2::VERTEX_SHADER | PipelineStageFlags2::FRAGMENT_SHADER,
        //     AccessFlags2::MEMORY_READ,
        // );
        // command_buffer.pipeline_barrier(&[barrier], &[], &[]);

        // cmd_buffer.transition_image(
        //     &depth_image,
        //     ImageLayout::UNDEFINED,
        //     ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
        // );q
        // cmd_buffer.transition_image(
        //     &draw_image,
        //     ImageLayout::UNDEFINED,
        //     ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
        // );
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
            // assets: &self.assets,
        };
        self.forward_pipeline.render(&context, &cmd_buffer)?;
        // gui.draw(&contexot, &mut self.config, &mut self.scene_data)?;
        log::trace!("WAIT @ blit");
        self.gpu.device().wait_idle();
        self.gpu
            .debug_utils()
            .begin_debug_label(&cmd_buffer, "blit to swapchain");
        let barrier = sync::image_memory_barrier(
            &swapchain_image,
            PipelineStageFlags2::COLOR_ATTACHMENT_OUTPUT,
            AccessFlags2::COLOR_ATTACHMENT_WRITE,
            PipelineStageFlags2::TRANSFER,
            AccessFlags2::TRANSFER_READ,
            ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
            ImageLayout::TRANSFER_DST_OPTIMAL,
        );
        // cmd_buffer.transition_image(
        //     &draw_image,
        //     ImageLayout::UNDEFINED,
        //     ImageLayout::TRANSFER_SRC_OPTIMAL,
        // );
        // cmd_buffer.transition_image(
        //     &swapchain_image,
        //     ImageLayout::UNDEFINED,
        //     ImageLayout::TRANSFER_DST_OPTIMAL,
        // );
        cmd_buffer.copy_image(
            &draw_image,
            &swapchain_image,
            render_extent,
            swapchain_extent.into(),
        );
        // cmd_buffer.transition_image(
        //     &swapchain_image,
        //     ImageLayout::TRANSFER_DST_OPTIMAL,
        //     ImageLayout::PRESENT_SRC_KHR,
        // );
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
        log::trace!("WAIT @ rebuild");
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
        self.frame_idx = self.frame_counter % IN_FLIGHT_FRAMES as usize;
        self.rebuild_swapchain |= rebuild_swapchain;

        log::trace!("WAIT @ end of render");
        self.gpu.device().wait_idle();

        log::trace!("EXIT render");
        Ok(())
    }

    // fn check_fence(&self, semaphore: &Semaphore) {
    //     match unsafe { self.gpu.device().handle().get_fence_status(fence) } {
    //         Ok(_) => log::trace!("Fence signaled"),
    //         Err(e) => log::error!("Not signaled because of error: {e:?}"),
    //         _ => log::trace!("Fence not signaled"),
    //     }
    // }

    fn create_render_objects<'a>(
        &self,
        scene: &'a Scene,
        assets: &'a Assets,
        materials: &'a HashMap<MaterialHandle, usize>,
    ) -> Vec<RenderObject> {
        scene
            .mesh_nodes()
            .map(|node| match node.data {
                NodeType::Mesh(handle) => {
                    let mesh = assets.get_mesh(handle).unwrap_or_else(|| {
                        panic!("Mesh not found: {:?}", handle);
                    });
                    let material = *materials
                        .get(&mesh.material)
                        .unwrap_or_else(|| panic!("Material not found: {:?}", mesh.material));
                    RenderObject {
                        vertex_count: mesh.vertex_count as usize,
                        material,
                        mesh: mesh.clone(),
                        transform: node.transform,
                    }
                }
                _ => {
                    panic!("Should not be here, node: {:?}", node);
                }
            })
            .collect::<Vec<_>>()
    }

    // fn create_render_objects2<'a>(&mut self, scene: &'a Scene, assets: &'a Assets) {
    //     let materials = &self.material_map;
    //     let objects = scene
    //         .mesh_nodes()
    //         .map(|node| match node.data {
    //             NodeType::Mesh(handle) => {
    //                 let mesh = assets.get_mesh(handle).unwrap_or_else(|| {
    //                     panic!("Mesh not found: {:?}", handle);
    //                 });
    //                 let material = *materials
    //                     .get(&mesh.material)
    //                     .unwrap_or_else(|| panic!("Material not found: {:?}", mesh.material));
    //                 RenderObject {
    //                     vertex_count: mesh.vertex_count as usize,
    //                     material,
    //                     mesh: mesh.clone(),
    //                     transform: node.transform,
    //                 }
    //             }
    //             _ => {
    //                 panic!("Should not be here, node: {:?}", node);
    //             }
    //         })
    //         .collect::<Vec<_>>();

    //     self.render_objects = objects;
    // }

    #[instrument(skip_all)]
    pub fn prepare_bindless(&mut self, assets: &mut Assets, scene: &Scene) -> Result<()> {
        log::trace!("WAIT @ start of prepare bindless");
        self.gpu.device().wait_idle();
        let cmd = &self.gpu.immediate_cmd_buffer();
        cmd.begin();

        let (textures, texture_map) = assets.map_textures(&cmd)?;
        let (_meshes, _mesh_map) = assets.map_meshes(&cmd)?;
        let (materials, material_map) = assets.map_materials(&texture_map)?;
        let fence = self.frames[self.frame_idx].fence;
        self.material_map = material_map;
        self.material_buffer.write(&materials);

        log::trace!("WAIT @ descriptor update in prepare bindless");
        self.binder
            .uniform_buffer(BIND_IDX_SCENE, &self.scene_buffer, 0)
            .uniform_buffer(BIND_IDX_MATERIAL, &self.material_buffer, 0)
            .texture_array(BIND_IDX_TEXTURE, &textures, assets.default_sampler())
            .update(&self.gpu)?;
        cmd.end();
        log::trace!("WAIT @ pre-submit in prepare bindless");
        self.gpu.device().wait_idle();

        self.render_objects = self.create_render_objects(scene, assets, &self.material_map);
        self.gpu.device().queue_submit(
            &self.gpu.device().graphics_queue(),
            &[***cmd],
            &[],
            &[],
            Fence::null(),
        );

        // self.gpu.device().wait_for_fences(&fences);
        log::trace!("WAIT @ end of prepare bindless");
        self.gpu.device().wait_idle();

        Ok(())
    }

    // fn prepare_scene(&self, scene: &Scene) -> GpuSceneData {
    //     let view = scene.camera.view();
    //     let projection = scene.camera.projection();

    //     GpuSceneData {
    //         view,
    //         projection,
    //         vp: projection * view.inverse(),
    //         camera_pos: scene.camera.position(),
    //         n_lights: LIGHTS.len() as i32,
    //         config: GpuConfig::from(&self.config),
    //         lights: LIGHTS,
    //     }
    // }

    fn create_frames(gpu: &Gpu) -> Result<Vec<Frame>> {
        let mut frames = Vec::new();
        for i in 0..IN_FLIGHT_FRAMES {
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
    pub model: Mat4,
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
