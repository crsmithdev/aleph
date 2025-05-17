use {
    crate::renderer::{RenderConfig, RenderContext},
    aleph_core::events::GuiEvent,
    aleph_scene::util,
    aleph_vk::{AttachmentLoadOp, AttachmentStoreOp, CommandPool, Extent2D, Format, Gpu},
    anyhow::Result,
    egui::{self},
    egui_ash_renderer as egui_renderer, egui_extras, egui_winit,
    glam::Vec4,
    gpu_allocator as ga,
    std::sync::{Arc, Mutex},
};

const CLEAR_COLOR: [f32; 4] = [0.0, 0.0, 0.0, 0.0];

pub struct Gui {
    ctx: egui::Context,
    state: egui_winit::State,
    renderer: egui_renderer::Renderer,
    pool: CommandPool,
    window: Arc<winit::window::Window>,
    textures_to_free: Option<Vec<egui::TextureId>>,
}

impl Gui {
    pub fn new(gpu: Arc<Gpu>, window: Arc<winit::window::Window>) -> Result<Self> {
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
        let queue = device.graphics_queue();
        let pool = device.create_command_pool(queue, "gui")?;

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
            ctx: egui_ctx,
            state: egui_winit,
            renderer,
            window: window.clone(),
            textures_to_free: None,
            pool,
        };
        Ok(gui)
    }

    pub fn draw(&mut self, ctx: &RenderContext, config: &mut RenderConfig) -> Result<()> {
        Ok(())
        // // let scene_data = &mut ctx.resources.scene_data;
        // let color_attachments = &[util::color_attachment(
        //     &*ctx.draw_image,
        //     AttachmentLoadOp::LOAD,
        //     AttachmentStoreOp::STORE,
        //     CLEAR_COLOR,
        // )];
        // let depth_attachment = &util::depth_attachment(
        //     &*ctx.depth_image,
        //     AttachmentLoadOp::LOAD,
        //     AttachmentStoreOp::STORE,
        //     1.0,
        // );
        // let extent = Extent2D {
        //     width: ctx.draw_extent.width,
        //     height: ctx.draw_extent.height,
        // };

        // let raw_input = self.state.take_egui_input(&self.window);

        // let egui::FullOutput {
        //     platform_output,
        //     textures_delta,
        //     shapes,
        //     pixels_per_point,
        //     ..
        // } = self.ctx.run(raw_input, |ctx| build_ui(ctx, config));

        // self.state
        //     .handle_platform_output(&self.window, platform_output);

        // if !textures_delta.free.is_empty() {
        //     self.textures_to_free = Some(textures_delta.free.clone());
        // }

        // if !textures_delta.set.is_empty() {
        //     self.renderer
        //         .set_textures(
        //             ctx.gpu.device().graphics_queue().handle(),
        //             self.pool.handle(),
        //             textures_delta.set.as_slice(),
        //         )
        //         .expect("Failed to set textures");
        // }
        // let clipped_primitives = self.ctx.tessellate(shapes, pixels_per_point);
        // let device = ctx.gpu.device();
        // let cmd = &ctx.cmd_recorder;

        // cmd.begin_rendering(color_attachments, Some(depth_attachment), ctx.draw_extent);
        // self.renderer
        //     .cmd_draw(cmd.handle(), extent, pixels_per_point, &clipped_primitives)?;
        // cmd.end_rendering();

        // Ok(())
    }

    pub fn handle_events<'a>(&'a mut self, events: impl Iterator<Item = &'a GuiEvent>) {
        events.for_each(|event| {
            let _ = self.state.on_window_event(&self.window, &event.0);
        });
    }
}

fn build_ui(ctx: &egui::Context, config: &mut RenderConfig) {
    egui::Window::new("Shader Config")
        .max_width(350.)
        .default_width(350.)
        .resizable(false)
        .show(ctx, |ui| {
            ui.heading("Debug");
            ui.horizontal(|ui| {
                ui.checkbox(&mut config.force_defaults, "Force defaults");
                ui.checkbox(&mut config.debug_normals, "Debug normals");
                ui.checkbox(&mut config.debug_tangents, "Debug tangents");
            });
            ui.horizontal(|ui| {
                ui.checkbox(&mut config.debug_bitangents, "Debug bitangents");
                ui.checkbox(&mut config.debug_specular, "Debug specular");
                ui.checkbox(&mut config.debug_normal_maps, "Disable normal maps");
            });

            ui.separator();
            ui.heading("Lights");

            // ui.horizontal(|ui| {
            //     ui.add(
            //         egui::Slider::new(&mut scene_data.n_lights, 0..=4)
            //             .step_by(1.0)
            //             .text("# Lights"),
            //     );
            // });

            // light(ui, &mut scene_data.lights[0], 1);
            // light(ui, &mut scene_data.lights[1], 2);
            // light(ui, &mut scene_data.lights[2], 3);
            // light(ui, &mut scene_data.lights[3], 4);

            ui.separator();
            ui.heading("Material");
            pbr_override_vec4(
                ui,
                &mut config.force_color,
                &mut config.force_color_factor,
                "Color",
            );
            pbr_override_scalar(
                ui,
                &mut config.force_metallic,
                &mut config.force_metallic_factor,
                "Metallic",
            );
            pbr_override_scalar(
                ui,
                &mut config.force_roughness,
                &mut config.force_roughness_factor,
                "Roughness",
            );
            pbr_override_scalar(
                ui,
                &mut config.force_ao,
                &mut config.force_ao_strength,
                "AO",
            );
        });
}

// fn light(ui: &mut egui::Ui, light: &mut Light, n: i32) {
//     egui::Grid::new(format!("light-{n:02}"))
//         .min_col_width(50.)
//         .max_col_width(250.)
//         .show(ui, |ui| {
//             ui.label(format!("Light {}", n));
//             ui.label("Position:");
//             drag_value(ui, &mut light.position.x, "x", 25.);
//             drag_value(ui, &mut light.position.y, "y", 25.);
//             drag_value(ui, &mut light.position.z, "z", 25.);
//             ui.end_row();

//             ui.label("");
//             ui.label("Color:");
//             drag_value(ui, &mut light.color.x, "r", 255.);
//             drag_value(ui, &mut light.color.y, "g", 255.);
//             drag_value(ui, &mut light.color.z, "b", 255.);
//             drag_value(ui, &mut light.color.w, "a", 255.);
//             ui.end_row();
//         });
// }

fn drag_value(ui: &mut egui::Ui, value: &mut f32, label: &str, max: f32) {
    let range = 0.0..=max;
    let speed = max / 100.;
    ui.horizontal(|ui| {
        ui.label(label);
        ui.add(egui::DragValue::new(value).speed(speed).range(range));
    });
}

fn pbr_override_vec4(ui: &mut egui::Ui, flag: &mut bool, value: &mut Vec4, label: &str) {
    egui::Grid::new(format!("override-scalar-{label}"))
        .min_col_width(50.)
        .max_col_width(250.)
        .show(ui, |ui| {
            ui.label(label);
            ui.checkbox(flag, "Override?");
            drag_value(ui, &mut value.x, "r", 1.);
            drag_value(ui, &mut value.y, "g", 1.);
            drag_value(ui, &mut value.z, "b", 1.);
            drag_value(ui, &mut value.w, "a", 1.);
            ui.end_row();
        });
}

fn pbr_override_scalar(
    ui: &mut egui::Ui,
    flag: &mut bool,
    mut value: &mut f32,
    label: &str,
) -> egui::Response {
    ui.horizontal(|ui| {
        ui.label("Override?");
        ui.checkbox(flag, label);
        drag_value(ui, &mut value, "r", 1.);
        ui.end_row();
    })
    .response
}
