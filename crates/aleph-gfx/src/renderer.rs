use {
    crate::{gui::Gui, ForwardPipeline, Pipeline},
    aleph_scene::{model::Light, Assets, Scene},
    aleph_vk::{
        AllocatedTexture, Buffer, BufferUsageFlags, CommandBuffer, Extent2D, Extent3D, Format,
        Frame, Gpu, ImageAspectFlags, ImageLayout, ImageUsageFlags, Texture,
    },
    anyhow::Result,
    bytemuck::{Pod, Zeroable},
    glam::{vec3, vec4, Mat4, Vec2, Vec3, Vec4},
    std::{mem, sync::Arc},
    tracing::instrument,
};
#[repr(C)]
#[derive(Debug, Default, Clone, Copy, Pod, Zeroable)]
pub struct Config {
    pub force_color: Vec4,
    pub force_metallic: Vec2,
    pub force_roughness: Vec2,
    pub force_ao: Vec2,
    pub padding0: Vec2,
}
#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuSceneData {
    pub view: Mat4,
    pub projection: Mat4,
    pub vp: Mat4,
    pub camera_pos: Vec3,
    pub n_lights: i32,
    pub config: Config,
    pub lights: [Light; 4],
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuMaterialData {
    pub color_factor: Vec4,
    pub metallic_factor: f32,
    pub roughness_factor: f32,
    pub ao_strength: f32,
    pub padding0: f32,
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuDrawData {
    pub model: Mat4,
    pub mv: Mat4,
    pub mvp: Mat4,
    pub transform: Mat4,
}

pub struct RenderContext<'a> {
    pub gpu: &'a Gpu,
    pub scene: &'a Scene,
    pub cmd_buffer: &'a CommandBuffer,
    pub scene_buffer: &'a Buffer<GpuSceneData>,
    pub draw_image: &'a AllocatedTexture,
    pub depth_image: &'a AllocatedTexture,
    pub extent: Extent2D,
    pub assets: &'a mut Assets,
}

pub(crate) const FORMAT_DRAW_IMAGE: Format = Format::R16G16B16A16_SFLOAT;
pub(crate) const FORMAT_DEPTH_IMAGE: Format = Format::D32_SFLOAT;
const LIGHTS: [Light; 4] = [
    Light {
        position: vec3(2., 2., 2.),
        color: vec4(3., 3., 3., 3.),
        radius: 10.,
    },
    Light {
        position: vec3(-2., -2., -2.),
        color: vec4(3., 3., 3., 3.),
        radius: 10.,
    },
    Light {
        position: vec3(-2., 2., 2.),
        color: vec4(3., 3., 3., 3.),
        radius: 10.,
    },
    Light {
        position: vec3(2., -2., -2.),
        color: vec4(3., 3., 3., 3.),
        radius: 10.,
    },
];

#[derive(Clone, Default)]
pub struct RendererConfig {
    pub clear_color: Vec3,
    pub initial_scene: Option<String>,
    pub auto_rotate: bool,
    pub debug_normals: bool,
}

pub struct Renderer {
    frames: Vec<Frame>,
    foreward_pipeline: ForwardPipeline,
    rebuild_swapchain: bool,
    frame_index: usize,
    frame_counter: usize,
    draw_image: AllocatedTexture,
    // debug_pipeline: DebugPipeline,
    depth_image: AllocatedTexture,
    config: RendererConfig,
    scene_buffer: Buffer<GpuSceneData>,
    scene_buffer_data: GpuSceneData,
    pub gui: Gui,
    pub gpu: Arc<Gpu>,
}

impl Renderer {
    pub fn new(gpu: Arc<Gpu>, config: RendererConfig) -> Result<Self> {
        let frames = Self::create_frames(&gpu)?;
        let draw_image = gpu.create_texture(
            gpu.swapchain().extent(),
            FORMAT_DRAW_IMAGE,
            ImageUsageFlags::COLOR_ATTACHMENT
                | ImageUsageFlags::TRANSFER_DST
                | ImageUsageFlags::TRANSFER_SRC
                | ImageUsageFlags::STORAGE,
            ImageAspectFlags::COLOR,
            "renderer-draw",
            None,
        )?;

        let depth_image = gpu.create_texture(
            gpu.swapchain().extent(),
            FORMAT_DEPTH_IMAGE,
            ImageUsageFlags::DEPTH_STENCIL_ATTACHMENT,
            ImageAspectFlags::DEPTH,
            "renderer-depth",
            None,
        )?;

        let scene_buffer = gpu.create_shared_buffer::<GpuSceneData>(
            mem::size_of::<GpuSceneData>() as u64,
            BufferUsageFlags::TRANSFER_DST | BufferUsageFlags::UNIFORM_BUFFER,
            "renderer-scene",
        )?;

        let foreward_pipeline = ForwardPipeline::new(&gpu)?;
        // let debug_pipeline = DebugPipeline::new(&gpu)?;
        let scene_data = GpuSceneData {
            lights: LIGHTS,
            n_lights: 3,
            ..Default::default()
        };

        let gui = Gui::new(&gpu, gpu.window())?;

        Ok(Self {
            gpu,
            gui,
            frames,
            foreward_pipeline,
            draw_image,
            depth_image,
            scene_buffer_data: scene_data,
            rebuild_swapchain: false,
            scene_buffer,
            // debug_pipeline,
            frame_index: 0,
            frame_counter: 0,
            config,
        })
    }
    fn update_scene_buffer(&mut self, scene: &Scene) {
        let view = scene.camera.view();
        let projection = scene.camera.projection();

        self.scene_buffer_data.view = view;
        self.scene_buffer_data.projection = projection;
        self.scene_buffer_data.vp = projection * view;
        self.scene_buffer_data.camera_pos = scene.camera.position();

        self.scene_buffer.write(&[self.scene_buffer_data]);
    }

    #[instrument(skip_all)]
    pub fn execute(&mut self, scene: &Scene, assets: &mut Assets) -> Result<()> {
        self.update_scene_buffer(scene);

        if self.rebuild_swapchain {
            self.gpu.rebuild_swapchain()?;
            self.frames = Self::create_frames(&self.gpu)?;
            self.rebuild_swapchain = false;
        }

        let Frame {
            swapchain_semaphore,
            command_buffer,
            render_semaphore,
            fence,
            ..
        } = &self.frames[self.frame_index];

        self.gpu.wait_for_fence(*fence)?;
        let (image_index, rebuild) = {
            let (image_index, rebuild) = self
                .gpu
                .swapchain()
                .acquire_next_image(*swapchain_semaphore)?;
            (image_index as usize, rebuild)
        };

        self.rebuild_swapchain = rebuild;
        self.gpu.reset_fence(*fence)?;

        let cmd_buffer = &command_buffer;
        cmd_buffer.reset()?;
        cmd_buffer.begin()?;
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

        cmd_buffer.transition_image(
            &self.depth_image,
            ImageLayout::UNDEFINED,
            ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
        );

        cmd_buffer.transition_image(
            &self.draw_image,
            ImageLayout::UNDEFINED,
            ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
        );
        let context = RenderContext {
            gpu: &self.gpu,
            scene,
            cmd_buffer: &self.frames[self.frame_index].command_buffer,
            scene_buffer: &self.scene_buffer,
            draw_image: &self.draw_image,
            depth_image: &self.depth_image,
            extent: self.gpu.swapchain().extent(),
            assets,
        };
        self.foreward_pipeline.execute(&context)?;
        // if self.config.debug_normals {
        //     self.debug_pipeline.execute(&context)?;
        // }

        // self.gui.draw(&context, |ctx| {
        // build_ui(ctx, &mut self.config, &mut self.scene_buffer_data)
        // })?;

        cmd_buffer.transition_image(
            &self.draw_image,
            ImageLayout::UNDEFINED,
            ImageLayout::TRANSFER_SRC_OPTIMAL,
        );
        cmd_buffer.transition_image(
            swapchain_image,
            ImageLayout::UNDEFINED,
            ImageLayout::TRANSFER_DST_OPTIMAL,
        );
        cmd_buffer.copy_image(
            &self.draw_image,
            swapchain_image,
            draw_extent,
            swapchain_extent.into(),
        );
        cmd_buffer.transition_image(
            swapchain_image,
            ImageLayout::TRANSFER_DST_OPTIMAL,
            ImageLayout::PRESENT_SRC_KHR,
        );

        cmd_buffer.end()?;
        cmd_buffer.submit_queued(*swapchain_semaphore, *render_semaphore, *fence)?;
        let rebuild = self
            .gpu
            .swapchain()
            .present(&[*render_semaphore], &[image_index as u32])?;

        self.rebuild_swapchain |= rebuild;
        self.frame_index = image_index;
        self.frame_counter += 1;

        Ok(())
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

// fn build_ui(ctx: &egui::Context, config: &mut RendererConfig, data: &mut GpuSceneData) {
//     egui::Window::new("Demo texture").show(ctx, |ui| {
//         ui.label("Debug");
//         ui.add(egui::Checkbox::new(
//             &mut config.debug_normals,
//             "Show normals",
//         ));
//         ui.add(egui::Checkbox::new(&mut config.auto_rotate, "Auto rotate"));
//         ui.label("Lights");
//         ui.add(
//             egui::Slider::new(&mut data.n_lights, 0..=4)
//                 .step_by(1.0)
//                 .text("# Lights"),
//         );
//         ui.horizontal(|ui| {
//             ui.label("0 R:");
//             ui.add(egui::DragValue::new(&mut data.lights[0].color.x).speed(0.1));
//             ui.label("G:");
//             ui.add(egui::DragValue::new(&mut data.lights[0].color.y).speed(0.1));
//             ui.label("B:");
//             ui.add(egui::DragValue::new(&mut data.lights[0].color.z).speed(0.1));
//             ui.label("A:");
//             ui.add(egui::DragValue::new(&mut data.lights[0].color.z).speed(0.1));
//         });
//         ui.separator();
//         ui.label("Material");

//         let mut force_metallic = data.config.force_metallic > -0.5;
//         let mut metallic = 0.;

//         ui.horizontal(|ui| {
//             ui.label("Metalness:");
//             ui.checkbox(&mut force_metallic, "Override?");
//             ui.add(egui::Slider::new(&mut metallic, 0.0..=1.0).text("Value"));
//             data.config.force_metallic = metallic;
//             if force_metallic {
//                 data.config.force_roughness = -1.0;
//             }
//         });
//     });
// }
