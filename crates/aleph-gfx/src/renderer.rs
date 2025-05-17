use {
    crate::{ForwardPipeline, Gui, Pipeline, ResourceBinder, ResourceLayout},
    aleph_scene::{
        model::Light, Assets, MaterialHandle, NodeType, Primitive, Scene, TextureHandle,
    },
    aleph_vk::{
        command::{self, CommandRecorder},
        swapchain, sync, AccessFlags2, CommandBuffer, CommandBufferSubmitInfo, Extent2D, Fence,
        Format, Frame, Gpu, ImageAspectFlags, ImageLayout, ImageUsageFlags, PipelineStageFlags2,
        Semaphore, SemaphoreSubmitInfo, ShaderStageFlags, SubmitInfo2, Texture, TextureInfo,
        TypedBuffer,
    },
    anyhow::{anyhow, Result},
    ash::vk::{FenceCreateFlags, QUEUE_FAMILY_IGNORED},
    bytemuck::{Pod, Zeroable},
    glam::{vec3, vec4, Mat4, Vec3, Vec4},
    std::{collections::HashMap, sync::Arc},
    tracing::instrument,
};

pub struct RenderContext<'a> {
    pub gpu: &'a Gpu,
    pub cmd_buffer: &'a CommandBuffer,
    pub draw_extent: Extent2D,
    pub binder: &'a ResourceBinder,
    pub objects: Vec<RenderObject<'a>>,
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
    material_map: HashMap<MaterialHandle, usize>,
    scene_buffer: TypedBuffer<GpuSceneData>,
    scene_data: GpuSceneData,
    material_buffer: TypedBuffer<GpuMaterialData>,
    binder: ResourceBinder,
    pub gpu: Arc<Gpu>,
    config: RenderConfig,
    pub prepared: bool,
}

pub struct RenderObject<'a> {
    pub primitive: &'a Primitive,
    pub material: usize,
    pub transform: Mat4,
}

#[derive(Default)]
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

        let binder = ResourceLayout::set(SET_IDX_BINDLESS)
            .uniform_buffer(BIND_IDX_SCENE, ShaderStageFlags::ALL_GRAPHICS)
            .uniform_buffer(BIND_IDX_MATERIAL, ShaderStageFlags::ALL_GRAPHICS)
            .texture_array(BIND_IDX_TEXTURE, ShaderStageFlags::ALL_GRAPHICS)
            .finish(&gpu)?;

        let foreward_pipeline =
            ForwardPipeline::new(&gpu, &binder.descriptor_layout(), &draw_image, &depth_image)?;
        let material_buffer = TypedBuffer::shared_uniform(&gpu, 10, "material")?;
        let scene_buffer = TypedBuffer::shared_uniform(&gpu, 1, "scene")?;

        Ok(Self {
            gpu,
            frames,
            forward_pipeline: foreward_pipeline,
            draw_image,
            depth_image,
            rebuild_swapchain: false,
            frame_index: 0,
            frame_counter: 0,
            prepared: false,
            binder,
            material_map: HashMap::new(),
            scene_data: GpuSceneData::default(),
            material_buffer,
            scene_buffer,
            config: RenderConfig::default(),
        })
    }

    #[instrument(skip_all)]
    pub fn render(&mut self, scene: &Scene, assets: &Assets, gui: &mut Gui) -> Result<()> {
        // log::trace!("Render frame");
        if self.rebuild_swapchain {
            let extent = self.gpu.swapchain().extent();
            self.gpu.rebuild_swapchain(extent);
        }
        let (image_index, rebuild) = self.begin_frame();

        self.scene_data = self.prepare_scene(scene);
        self.scene_buffer.write(&[self.scene_data]);

        // let ctx = self.create_context(scene, assets);
        let cmd_buffer = &self.frames[self.frame_index].command_buffer.clone();
        let ctx = RenderContext {
            gpu: &self.gpu,
            cmd_buffer,
            draw_extent: self.draw_extent(),
            binder: &self.binder,
            objects: self.create_render_objects(scene, assets, &self.material_map),
        };
        let cmd = &ctx.cmd_buffer.record(&self.gpu.device());

        cmd.transition_image(
            &self.depth_image,
            ImageLayout::UNDEFINED,
            ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
        );

        cmd.transition_image(
            &self.draw_image,
            ImageLayout::UNDEFINED,
            ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
        );

        self.forward_pipeline.render(&ctx)?;
        // gui.draw(&ctx, &mut self.config)?;

        cmd.transition_image(
            &self.draw_image,
            ImageLayout::UNDEFINED,
            ImageLayout::TRANSFER_SRC_OPTIMAL,
        );

        let swapchain_image = &self.gpu.swapchain().images()[image_index];
        let swapchain_pre_barrier = sync::image_memory_barrier(
            &swapchain_image,
            PipelineStageFlags2::NONE,
            AccessFlags2::NONE,
            PipelineStageFlags2::COLOR_ATTACHMENT_OUTPUT_KHR,
            AccessFlags2::COLOR_ATTACHMENT_WRITE,
            ImageAspectFlags::COLOR,
            ImageLayout::UNDEFINED,
            ImageLayout::TRANSFER_DST_OPTIMAL,
            QUEUE_FAMILY_IGNORED,
            QUEUE_FAMILY_IGNORED,
        );
        cmd.pipeline_barrier(&[], &[], &[swapchain_pre_barrier]);

        // cmd.transition_image(
        //     &swapchain_image,
        //     ImageLayout::UNDEFINED,
        //     ImageLayout::TRANSFER_DST_OPTIMAL,
        // );
        cmd.copy_image(
            &self.draw_image,
            &swapchain_image,
            self.draw_extent(),
            swapchain_image.extent(),
        );

        // cmd.transition_image(
        //     &swapchain_image,
        //     ImageLayout::TRANSFER_DST_OPTIMAL,
        //     ImageLayout::PRESENT_SRC_KHR,
        // );

        let swapchain_post_barrier = sync::image_memory_barrier(
            &swapchain_image,
            PipelineStageFlags2::COLOR_ATTACHMENT_OUTPUT_KHR,
            AccessFlags2::COLOR_ATTACHMENT_WRITE,
            PipelineStageFlags2::NONE,
            AccessFlags2::NONE,
            ImageAspectFlags::COLOR,
            ImageLayout::TRANSFER_DST_OPTIMAL,
            ImageLayout::PRESENT_SRC_KHR,
            QUEUE_FAMILY_IGNORED,
            QUEUE_FAMILY_IGNORED,
        );
        cmd.pipeline_barrier(&[], &[], &[swapchain_post_barrier]);
        assets.uploader().submit();

        // let rebuild = self.end_frame(image_index);
        let fence = self.frames[self.frame_index].fence;
        let render_semaphore = self.frames[self.frame_index].render_semaphore;
        let cmd_buffer = &mut self.frames[self.frame_index].command_buffer;

        self.gpu
            .device()
            .queue_submit2(self.gpu.device().graphics_queue(), cmd_buffer, fence);
        self.gpu
            .swapchain()
            .present(&[render_semaphore], &[image_index as u32])
            .unwrap_or_else(|e| panic!("Error presenting swapchain: {:?}", e));
        self.rebuild_swapchain = rebuild;

        self.frame_index = image_index;
        self.frame_counter += 1;

        Ok(())
    }

    pub fn begin_frame(&self) -> (usize, bool) {
        // log::trace!("Begin frame");
        let fence = &self.frames[self.frame_index].fence;
        let semaphore = &self.frames[self.frame_index].swapchain_semaphore;

        self.gpu.wait_for_fence(*fence);
        let (index, rebuild) = self
            .gpu
            .swapchain()
            .acquire_next_image(*semaphore)
            .unwrap_or_else(|e| {
                panic!(
                    "Error acquiring next image at {} (index: {}): {:?}",
                    self.frame_counter, self.frame_index, e
                );
            });
        self.gpu.reset_fence(*fence);

        (index, rebuild)
    }

    fn end_frame(&mut self, image_index: usize) -> bool {
        let cmd_buffer = &mut self.frames[self.frame_index].command_buffer.clone();
        let fence = &self.frames[self.frame_index].fence;
        let render_semaphore = self.frames[self.frame_index].render_semaphore;

        self.gpu
            .device()
            .queue_submit2(self.gpu.device().graphics_queue(), cmd_buffer, *fence);
        self.gpu
            .swapchain()
            .present(&[render_semaphore], &[image_index as u32])
            .unwrap_or_else(|e| panic!("Error presenting swapchain: {:?}", e))
    }

    fn create_render_objects<'a>(
        &self,
        scene: &'a Scene,
        assets: &'a Assets,
        materials: &'a HashMap<MaterialHandle, usize>,
    ) -> Vec<RenderObject<'a>> {
        // log::trace!("Create render objects");

        let mut drawables = vec![];
        for node in scene.mesh_nodes() {
            match node.data {
                NodeType::Mesh(handle) => {
                    let mesh = assets.mesh(handle).unwrap();
                    let transform = node.transform;
                    for primitive in mesh.primitives.iter() {
                        drawables.push(RenderObject {
                            primitive,
                            material: materials[&primitive.material],
                            transform,
                        })
                    }
                }
                _ => {}
            }
        }
        drawables
    }

    // fn create_context<'a>(
    //     cmd_buffer: &'a CommandBuffer,
    //     frame: &'a [Frame],
    //     objects: Vec<RenderObject<'a>>,
    //     scene: &'a Scene,
    //     assets: &'a Assets,
    // ) -> RenderContext<'a> {
    //     // fn create_context<'a>(&'a self, scene: &'a Scene, assets: &'a Assets) -> RenderContext<'a> {
    //     // log::trace!("Create context");

    //     // let frame = &frames[self.frame_index];
    //     // let cmd_buffer = &frame.command_buffer;
    //     // let objects = self.create_render_objects(scene, assets, &self.material_map);
    //     // let binder = &self.binder;
    //     let draw_extent = {
    //         let extent = self.draw_image.extent();
    //         Extent2D {
    //             width: extent.width.min(self.gpu.swapchain().extent().width),
    //             height: extent.height.min(self.gpu.swapchain().extent().height),
    //         }
    //     };
    //     RenderContext {
    //         gpu: &self.gpu,
    //         draw_extent,
    //         binder,
    //         objects,
    //         cmd_buffer,
    //     }
    // }

    fn create_frames(gpu: &Gpu) -> Result<Vec<Frame>> {
        (0..gpu.swapchain().in_flight_frames())
            .map(|i| {
                let queue = gpu.device().graphics_queue();
                let name = &format!("frame{i:02}");
                let command_pool = gpu.device().create_command_pool(queue, name)?;
                let swapchain_semaphore = gpu.device().create_semaphore();
                let render_semaphore = gpu.device().create_semaphore();
                let fence = gpu.device().create_fence(FenceCreateFlags::SIGNALED);

                let mut command_buffer = command_pool.create_command_buffer(name);
                command_buffer.wait_semaphore(swapchain_semaphore);
                command_buffer.signal_semaphore(render_semaphore);
                command_buffer.fence(fence);

                Ok(Frame {
                    swapchain_semaphore,
                    render_semaphore,
                    fence,
                    command_pool,
                    command_buffer,
                })
            })
            .collect()
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
        // log::trace!("Prepare resources");

        let scene_data = self.prepare_scene(scene);
        let (textures, texture_map) = self.prepare_textures(assets)?;
        let (materials, material_map) = self.prepare_materials(assets, &texture_map)?;

        self.material_map = material_map;
        self.scene_data = scene_data;
        self.material_buffer.write(&materials);
        self.scene_buffer.write(&[scene_data]);

        self.binder
            .uniform_buffer(BIND_IDX_SCENE, &self.scene_buffer, 0)
            .uniform_buffer(BIND_IDX_MATERIAL, &self.material_buffer, 0)
            .texture_array(BIND_IDX_TEXTURE, &textures, assets.default_sampler())
            .update(&self.gpu)?;

        // log::trace!("END PREPARE RESOURCES");
        Ok(())
    }

    fn prepare_scene(&self, scene: &Scene) -> GpuSceneData {
        // log::trace!("Prepare scene");

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
        // log::trace!("Prepare textures");

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

    fn draw_extent(&self) -> Extent2D {
        let extent = self.draw_image.extent();
        Extent2D {
            width: extent.width.min(self.gpu.swapchain().extent().width),
            height: extent.height.min(self.gpu.swapchain().extent().height),
        }
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
