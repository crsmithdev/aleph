use {
    crate::{ForwardPipeline, Gui, Pipeline, ResourceBinder, ResourceLayout},
    aleph_scene::{model::Light, Assets, MaterialHandle, Scene, TextureHandle},
    aleph_vk::{
        swapchain, AccessFlags2, CommandBuffer, CommandBufferSubmitInfo, Extent2D, Extent3D, Fence,
        Format, Frame, Gpu, ImageAspectFlags, ImageLayout, ImageUsageFlags, PipelineStageFlags2,
        Semaphore, SemaphoreSubmitInfo, ShaderStageFlags, SubmitInfo2, Texture, TextureInfo,
        TypedBuffer,
    },
    anyhow::{anyhow, Result},
    ash::vk::QUEUE_FAMILY_IGNORED,
    bytemuck::{Pod, Zeroable},
    glam::{vec3, vec4, Mat4, Vec3, Vec4},
    std::{collections::HashMap, sync::Arc},
    tracing::instrument,
};

pub struct ResourceInfo {
    pub binder: ResourceBinder,
    pub material_map: HashMap<MaterialHandle, usize>,
    pub texture_map: HashMap<TextureHandle, usize>,
    pub scene_buffer: TypedBuffer<GpuSceneData>,
    pub scene_data: GpuSceneData,
    pub material_buffer: TypedBuffer<GpuMaterialData>,
    pub material_data: GpuMaterialData,
}

pub struct RenderContext<'a> {
    pub gpu: &'a Gpu,
    pub scene: &'a Scene,
    pub frame: &'a Frame,
    pub command_buffer: &'a CommandBuffer,
    pub draw_image: &'a Texture,
    pub depth_image: &'a Texture,
    pub extent: Extent2D,
    pub assets: &'a Assets,
    pub resources: &'a ResourceInfo,
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

pub struct Renderer {
    frames: Vec<Frame>,
    forward_pipeline: ForwardPipeline,
    rebuild_swapchain: bool,
    frame_index: usize,
    frame_counter: usize,
    draw_image: Texture,
    depth_image: Texture,
    // scene_data: GpuSceneData,
    resources: ResourceInfo,
    pub gpu: Arc<Gpu>,
    config: RenderConfig,
    pub prepared: bool,
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
        let frames = Self::create_frames(&gpu)?;
        let draw_info = TextureInfo {
            name: "draw".to_string(),
            extent: gpu.swapchain().extent().into(),
            format: FORMAT_DRAW_IMAGE,
            flags: ImageUsageFlags::COLOR_ATTACHMENT
                | ImageUsageFlags::TRANSFER_DST
                | ImageUsageFlags::TRANSFER_SRC
                | ImageUsageFlags::STORAGE,
            aspect_flags: ImageAspectFlags::COLOR,
            data: vec![],
            sampler: None,
        };
        let draw_image = Texture::new(&gpu, &draw_info)?;

        let depth_info = TextureInfo {
            name: "depth".to_string(),
            extent: gpu.swapchain().extent().into(),
            format: FORMAT_DEPTH_IMAGE,
            flags: ImageUsageFlags::DEPTH_STENCIL_ATTACHMENT
                | ImageUsageFlags::TRANSFER_DST
                | ImageUsageFlags::TRANSFER_SRC,
            aspect_flags: ImageAspectFlags::DEPTH,
            data: vec![],
            sampler: None,
        };
        let depth_image = Texture::new(&gpu, &depth_info)?;

        let resources = ResourceInfo {
            binder: ResourceLayout::set(SET_IDX_BINDLESS)
                .uniform_buffer(BIND_IDX_SCENE, ShaderStageFlags::ALL_GRAPHICS)
                .uniform_buffer(BIND_IDX_MATERIAL, ShaderStageFlags::ALL_GRAPHICS)
                .texture_array(BIND_IDX_TEXTURE, ShaderStageFlags::ALL_GRAPHICS)
                .finish(&gpu)?,
            material_map: HashMap::new(),
            texture_map: HashMap::new(),
            scene_buffer: TypedBuffer::shared_uniform(&gpu, 1, "scene")?,
            material_buffer: TypedBuffer::shared_uniform(&gpu, 10, "material")?,
            scene_data: GpuSceneData::default(),
            material_data: GpuMaterialData::default(),
        };

        let foreward_pipeline = ForwardPipeline::new(&gpu, &resources)?;

        Ok(Self {
            gpu,
            frames,
            forward_pipeline: foreward_pipeline,
            draw_image,
            depth_image,
            rebuild_swapchain: false,
            resources,
            frame_index: 0,
            frame_counter: 0,
            prepared: false,
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
        })
    }

    #[instrument(skip_all)]
    pub fn render(&mut self, scene: &Scene, assets: &Assets, gui: &mut Gui) -> Result<()> {
        if self.rebuild_swapchain {
            let extent = self.gpu.swapchain().extent();
            self.gpu.rebuild_swapchain(extent)?;
            self.frames = Self::create_frames(&self.gpu)?;
            self.rebuild_swapchain = false;
        }
        let context = RenderContext {
            gpu: &self.gpu,
            scene,
            frame: &self.frames[self.frame_index],
            command_buffer: &self.frames[self.frame_index].command_buffer,
            draw_image: &self.draw_image,
            depth_image: &self.depth_image,
            extent: self.gpu.swapchain().extent(),
            resources: &self.resources,
            assets,
        };
        let Frame {
            swapchain_semaphore,
            command_buffer,
            render_semaphore,
            fence,
            ..
        } = &self.frames[self.frame_index];

        self.gpu.wait_for_fence(*fence);
        let (image_index, rebuild) = self
            .gpu
            .swapchain()
            .acquire_next_image(*swapchain_semaphore)?;
        self.rebuild_swapchain = rebuild;
        self.gpu.reset_fence(*fence);

        let swapchain_extent = self.gpu.swapchain().extent();
        let swapchain_image = &self.gpu.swapchain().images()[image_index];
        let draw_extent = {
            let extent = self.draw_image.extent();
            Extent3D {
                width: extent.width.min(swapchain_extent.width),
                height: extent.height.min(swapchain_extent.height),
                depth: 1,
            }
        };
        // assets
        //     .uploader()
        //     .enqueue_buffer(&self.resources.scene_buffer, &[self.resources.scene_data])?;
        let cmd_buffer = &command_buffer;

        cmd_buffer.transition_image(
            &*self.depth_image,
            ImageLayout::UNDEFINED,
            ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
        );

        cmd_buffer.transition_image(
            &*self.draw_image,
            ImageLayout::UNDEFINED,
            ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
        );

        self.forward_pipeline.render(&context)?;
        gui.draw(&context, &mut self.config)?;

        cmd_buffer.transition_image(
            &*self.draw_image,
            ImageLayout::UNDEFINED,
            ImageLayout::TRANSFER_SRC_OPTIMAL,
        );
        cmd_buffer.transition_image(
            &*swapchain_image,
            ImageLayout::UNDEFINED,
            ImageLayout::TRANSFER_DST_OPTIMAL,
        );
        cmd_buffer.copy_image(
            &*self.draw_image,
            &*swapchain_image,
            draw_extent,
            swapchain_extent.into(),
        );

        cmd_buffer.image_barrier(
            &*swapchain_image,
            PipelineStageFlags2::TRANSFER,
            AccessFlags2::TRANSFER_WRITE,
            PipelineStageFlags2::BOTTOM_OF_PIPE,
            AccessFlags2::NONE,
            ImageAspectFlags::COLOR,
            ImageLayout::TRANSFER_DST_OPTIMAL,
            ImageLayout::PRESENT_SRC_KHR,
            QUEUE_FAMILY_IGNORED,
            QUEUE_FAMILY_IGNORED,
        );
        // cmd_buffer.transition_image(
        //     &*swapchain_image,
        //     ImageLayout::TRANSFER_DST_OPTIMAL,
        //     ImageLayout::PRESENT_SRC_KHR,
        // );
        cmd_buffer.end()?;

        self.gpu.queue_submit(
            &[&**cmd_buffer],
            &[*swapchain_semaphore],
            &[*render_semaphore],
            *fence,
        )?;
        let rebuild = self
            .gpu
            .swapchain()
            .present(&[*render_semaphore], &[image_index as u32])?;

        self.resources.scene_data = self.prepare_scene(scene);
        self.resources
            .scene_buffer
            .write(&[self.resources.scene_data]);
        assets.uploader().submit()?;

        self.rebuild_swapchain |= rebuild;
        self.frame_index = image_index;
        self.frame_counter += 1;

        Ok(())
    }

    pub fn submit_queued(
        &self,
        gpu: &Gpu,
        cmds: &[&CommandBuffer],
        wait_semaphore: Semaphore,
        signal_semaphore: Semaphore,
        fence: Fence,
    ) -> Result<(), anyhow::Error> {
        let queue = gpu.device().graphics_queue();

        let wait_info = &[SemaphoreSubmitInfo::default()
            .semaphore(wait_semaphore)
            .stage_mask(PipelineStageFlags2::COLOR_ATTACHMENT_OUTPUT)
            .value(1)];
        let signal_info = &[SemaphoreSubmitInfo::default()
            .semaphore(signal_semaphore)
            .stage_mask(PipelineStageFlags2::ALL_GRAPHICS)
            .value(1)];
        let command_buffer_info = cmds
            .into_iter()
            .map(|cmd_buffer| {
                CommandBufferSubmitInfo::default()
                    .command_buffer(cmd_buffer.handle())
                    .device_mask(0)
            })
            .collect::<Vec<_>>();
        let submit_info = &[SubmitInfo2::default()
            .command_buffer_infos(&command_buffer_info)
            .wait_semaphore_infos(wait_info)
            .signal_semaphore_infos(signal_info)];

        Ok(unsafe {
            gpu.device()
                .handle()
                .queue_submit2(queue.handle(), submit_info, fence)
        }?)
    }

    fn prepare_materials(
        &self,
        assets: &Assets,
        texture_map: &HashMap<TextureHandle, usize>,
    ) -> Result<(Vec<GpuMaterialData>, HashMap<MaterialHandle, usize>)> {
        let mut handle_map: HashMap<MaterialHandle, usize> = HashMap::new();
        let mut materials = vec![];

        for (handle, material) in assets.materials() {
            let color_texture = texture_map.get(&material.color_texture).unwrap_or(&0);
            let normal_texture = texture_map.get(&material.normal_texture).unwrap_or(&0);
            let metalrough_texture = texture_map.get(&material.metalrough_texture).unwrap_or(&0);
            let ao_texture = texture_map.get(&material.ao_texture).unwrap_or(&0);
            let gpu_material = GpuMaterialData {
                color_factor: material.color_factor,
                metallic_factor: material.metallic_factor,
                roughness_factor: material.roughness_factor,
                ao_strength: material.ao_strength,
                color_texture_index: *color_texture as i32,
                normal_texture_index: *normal_texture as i32,
                metalrough_texture_index: *metalrough_texture as i32,
                ao_texture_index: *ao_texture as i32,
                padding0: 0.,
            };

            materials.push(gpu_material);
            handle_map.insert(handle, materials.len() - 1);
        }
        Ok((materials, handle_map))
    }

    pub fn prepare_resources(&mut self, assets: &mut Assets, scene: &Scene) -> Result<()> {
        log::debug!("BEGIN PREPARE RESOURCES");
        let scene_data = self.prepare_scene(scene);
        let (textures, texture_map) = self.prepare_textures(assets)?;
        let (materials, material_map) = self.prepare_materials(assets, &texture_map)?;

        let resources = &mut self.resources;
        resources.texture_map = texture_map;
        resources.material_map = material_map;
        resources.scene_data = scene_data;

        // assets
        // .uploader()
        // .enqueue_buffer(&resources.material_buffer, &materials)?;
        // assets
        //     .uploader()
        //     .enqueue_buffer(&resources.scene_buffer, &[scene_data])?;
        resources.material_buffer.write(&materials);
        resources.scene_buffer.write(&[scene_data]);

        resources
            .binder
            .uniform_buffer(BIND_IDX_SCENE, &resources.scene_buffer, 0)
            .uniform_buffer(
                BIND_IDX_MATERIAL,
                &resources.material_buffer,
                // materials.len() as usize,
                0,
            )
            .texture_array(BIND_IDX_TEXTURE, &textures, assets.default_sampler())
            .update(&self.gpu)?;

        log::debug!("END PREPARE RESOURCES");
        Ok(())
    }

    fn prepare_scene(&mut self, scene: &Scene) -> GpuSceneData {
        let view = scene.camera.view();
        let projection = scene.camera.projection();
        GpuSceneData {
            view,
            projection,
            vp: projection * view.inverse(),
            camera_pos: scene.camera.position(),
            n_lights: LIGHTS.len() as i32,
            config: GpuConfig::from(&self.config),
            lights: LIGHTS,
        }
    }

    fn prepare_textures(
        &self,
        assets: &Assets,
    ) -> Result<(Vec<Texture>, HashMap<TextureHandle, usize>)> {
        let default_texture = assets
            .texture(assets.default_material().color_texture)
            .ok_or_else(|| anyhow!("Default texture not found"))?;
        let mut handle_map: HashMap<TextureHandle, usize> = HashMap::new();
        let mut textures = vec![default_texture];

        for (handle, texture) in assets.textures() {
            textures.push(texture);
            handle_map.insert(handle, textures.len() - 1);
        }

        Ok((textures, handle_map))
    }

    fn create_frames(gpu: &Gpu) -> Result<Vec<Frame>> {
        (0..gpu.swapchain().in_flight_frames())
            .map(|_| {
                let pool = gpu.create_command_pool()?;
                let command_buffer = pool.create_command_buffer()?;

                Ok(Frame {
                    swapchain_semaphore: gpu.create_semaphore()?,
                    render_semaphore: gpu.create_semaphore()?,
                    fence: gpu.create_fence_signaled()?,
                    command_pool: pool,
                    command_buffer,
                })
            })
            .collect()
    }
}

impl Drop for Renderer {
    fn drop(&mut self) { unsafe { self.gpu.device().handle().device_wait_idle().unwrap() }; }
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
pub struct GpuMaterialData {
    pub color_factor: Vec4,
    pub color_texture_index: i32,
    pub normal_texture_index: i32,
    pub metallic_factor: f32,
    pub roughness_factor: f32,
    pub metalrough_texture_index: i32,
    pub ao_strength: f32,
    pub ao_texture_index: i32,
    pub padding0: f32,
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
