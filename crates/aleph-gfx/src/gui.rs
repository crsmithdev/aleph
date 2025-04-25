use {
    crate::{
        renderer::{GpuSceneData, RendererConfig},
        RenderContext,
    },
    aleph_core::{
        system::{Resources, Scheduler},
        Layer, Window,
    },
    aleph_scene::util,
    aleph_vk::{AttachmentLoadOp, AttachmentStoreOp, CommandPool, Extent2D, Format, Gpu},
    anyhow::Result,
    egui, egui_ash_renderer as egui_renderer, egui_extras, egui_winit,
    glam::{Vec2, Vec4},
    gpu_allocator as ga,
    std::sync::{Arc, Mutex},
};

const CLEAR_COLOR: [f32; 4] = [0.0, 0.0, 0.0, 0.0];

pub struct Gui {
    pub egui_ctx: egui::Context,
    pub egui_winit: egui_winit::State,
    pub egui_renderer: egui_renderer::Renderer,
    pool: CommandPool,
    window: Arc<winit::window::Window>,
    textures_to_free: Option<Vec<egui::TextureId>>,
}

impl Layer for Gui {
    fn register(&mut self, _scheduler: &mut Scheduler, resources: &mut Resources) {
        let gpu = resources.get::<Arc<Gpu>>().clone();
        let window = resources.get::<Arc<Window>>().clone();
        let gui = Gui::new(&gpu, window).expect("Failed to create GUI");
        resources.add(gui);
    }
}

impl Gui {
    pub fn new(gpu: &Gpu, window: Arc<winit::window::Window>) -> Result<Self> {
        let egui_ctx = egui::Context::default();
        egui_extras::install_image_loaders(&egui_ctx);
        let egui_winit = egui_winit::State::new(
            egui_ctx.clone(),
            egui::ViewportId::ROOT,
            &window,
            None,
            None,
            None,
        );

        let device = gpu.device();
        let instance = gpu.instance();
        let physical_device = device.physical_device();
        let pool = gpu.create_command_pool()?;

        let renderer = {
            let allocator = ga::vulkan::Allocator::new(&ga::vulkan::AllocatorCreateDesc {
                instance: instance.handle().clone(),
                device: device.handle().clone(),
                physical_device: physical_device.clone(),
                buffer_device_address: true,
                debug_settings: ga::AllocatorDebugSettings::default(),
                allocation_sizes: ga::AllocationSizes::default(),
            })?;
            let dynamic_rendering = egui_renderer::DynamicRendering {
                color_attachment_format: Format::R16G16B16A16_SFLOAT,
                depth_attachment_format: Some(Format::D32_SFLOAT),
            };

            egui_renderer::Renderer::with_gpu_allocator(
                Arc::new(Mutex::new(allocator)),
                device.handle().clone(),
                dynamic_rendering,
                egui_renderer::Options {
                    srgb_framebuffer: true,
                    ..Default::default()
                },
            )
        }?;

        let gui = Self {
            egui_ctx,
            egui_winit,
            egui_renderer: renderer,
            window: window.clone(),
            textures_to_free: None,
            pool,
        };
        Ok(gui)
        // gui.on_window_event(&event.event);
        // Ok(())
        // });
    }

    pub fn draw(
        &mut self,
        ctx: &RenderContext,
        config: &mut RendererConfig,
        data: &mut GpuSceneData,
    ) -> Result<()> {
        let color_attachments = &[util::color_attachment(
            ctx.draw_image,
            AttachmentLoadOp::LOAD,
            AttachmentStoreOp::STORE,
            CLEAR_COLOR,
        )];
        let depth_attachment = &util::depth_attachment(
            ctx.depth_image,
            AttachmentLoadOp::LOAD,
            AttachmentStoreOp::STORE,
            1.0,
        );
        let extent = Extent2D {
            width: ctx.extent.width,
            height: ctx.extent.height,
        };

        let raw_input = self.egui_winit.take_egui_input(&self.window);

        let egui::FullOutput {
            platform_output,
            textures_delta,
            shapes,
            pixels_per_point,
            ..
        } = self
            .egui_ctx
            .run(raw_input, |ctx| build_ui(ctx, config, data));

        self.egui_winit
            .handle_platform_output(&self.window, platform_output);

        if !textures_delta.free.is_empty() {
            self.textures_to_free = Some(textures_delta.free.clone());
        }

        if !textures_delta.set.is_empty() {
            self.egui_renderer
                .set_textures(
                    ctx.gpu.device().queue().handle(),
                    self.pool.handle(),
                    textures_delta.set.as_slice(),
                )
                .expect("Failed to set textures");
        }
        let clipped_primitives = self.egui_ctx.tessellate(shapes, pixels_per_point);

        ctx.cmd_buffer
            .begin_rendering(color_attachments, Some(depth_attachment), ctx.extent)?;
        self.egui_renderer.cmd_draw(
            ctx.cmd_buffer.handle(),
            extent,
            pixels_per_point,
            &clipped_primitives,
        )?;
        ctx.cmd_buffer.end_rendering()?;

        Ok(())
    }

    pub fn on_window_event(&mut self, event: &winit::event::WindowEvent) {
        let _ = self.egui_winit.on_window_event(&self.window, event);
    }
}

fn build_ui(ctx: &egui::Context, config: &mut RendererConfig, data: &mut GpuSceneData) {
    egui::Window::new("Config").show(ctx, |ui| {
        ui.heading("Debug");
        ui.add(egui::Checkbox::new(
            &mut config.debug_normals,
            "Show normals",
        ));

        ui.separator();

        ui.heading("Lights");
        ui.add(
            egui::Slider::new(&mut data.n_lights, 0..=4)
                .step_by(1.0)
                .text("# Lights"),
        );
        rgba_picker(ui, &mut data.lights[0].color, "#0");
        rgba_picker(ui, &mut data.lights[1].color, "#1");
        rgba_picker(ui, &mut data.lights[2].color, "#2");
        rgba_picker(ui, &mut data.lights[3].color, "#3");

        ui.separator();

        ui.label("Material");
        vec4_override(ui, &mut data.config.force_color, "Color");
        vec2_override(ui, &mut data.config.force_metallic, "Metallic");
        vec2_override(ui, &mut data.config.force_roughness, "Roughness");
        vec2_override(ui, &mut data.config.force_ao, "Occlusion");
    });
}

fn rgba_picker(ui: &mut egui::Ui, data: &mut Vec4, label: impl Into<String>) -> egui::Response {
    ui.horizontal(|ui| {
        ui.label(label.into());
        ui.label("R");
        ui.add(egui::DragValue::new(&mut data.x).speed(0.1));
        ui.label("G");
        ui.add(egui::DragValue::new(&mut data.y).speed(0.1));
        ui.label("B");
        ui.add(egui::DragValue::new(&mut data.z).speed(0.1));
        ui.label("A");
        ui.add(egui::DragValue::new(&mut data.w).speed(0.1));
    })
    .response
}

fn vec2_override(ui: &mut egui::Ui, data: &mut Vec2, label: impl Into<String>) -> egui::Response {
    let mut flag = data[0] > 0.01;
    let mut value = data[1];

    ui.horizontal(|ui| {
        ui.label(label.into());
        ui.spacing();
        ui.checkbox(&mut flag, "Override?");
        ui.add(egui::DragValue::new(&mut value).speed(0.1).range(0.0..=1.0));

        *data = Vec2::new(if flag { 1.0 } else { 0.0 }, value);
    })
    .response
}

fn vec4_override(ui: &mut egui::Ui, data: &mut Vec4, label: impl Into<String>) -> egui::Response {
    let mut flag = data[0] > 0.01;
    let mut x = data[1];
    let mut y = data[2];
    let mut z = data[3];

    ui.horizontal(|ui| {
        ui.label(label.into());
        ui.spacing();
        ui.checkbox(&mut flag, "Override?");
        ui.add(egui::DragValue::new(&mut x).speed(0.1).range(0.0..=1.0));
        ui.add(egui::DragValue::new(&mut y).speed(0.1).range(0.0..=1.0));
        ui.add(egui::DragValue::new(&mut z).speed(0.1).range(0.0..=1.0));

        *data = Vec4::new(if flag { 1.0 } else { 0.0 }, x, y, z);
    })
    .response
}
