use {
    crate::{renderer::GpuConfigData, RenderContext, RenderFlags},
    aleph_core::{
        events::GuiEvent,
        system::{Resources, Scheduler},
        Layer, Window,
    },
    aleph_scene::util,
    aleph_vk::{AttachmentLoadOp, AttachmentStoreOp, CommandPool, Extent2D, Format, Gpu},
    anyhow::Result,
    derive_more::Debug,
    egui, egui_ash_renderer as egui_renderer, egui_extras, egui_winit, gpu_allocator as ga,
    std::sync::{Arc, Mutex},
};

const CLEAR_COLOR: [f32; 4] = [0.0, 0.0, 0.0, 0.0];

#[derive(Debug)]
pub struct Gui {
    ctx: egui::Context,
    #[debug(skip)]
    state: egui_winit::State,
    #[debug(skip)]
    renderer: egui_renderer::Renderer,
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
        let pool = CommandPool::new(&gpu.device(), &gpu.device().graphics_queue(), "egui");

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

    pub fn draw(&mut self, ctx: &RenderContext, config: &mut GpuConfigData) -> Result<()> {
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
            width: ctx.render_extent.width,
            height: ctx.render_extent.height,
        };

        let raw_input = self.state.take_egui_input(&self.window);

        let egui::FullOutput {
            platform_output,
            textures_delta,
            shapes,
            pixels_per_point,
            ..
        } = self.ctx.run(raw_input, |ctx| build_ui(ctx, config));

        self.state.handle_platform_output(&self.window, platform_output);

        if !textures_delta.free.is_empty() {
            self.textures_to_free = Some(textures_delta.free.clone());
        }

        if !textures_delta.set.is_empty() {
            self.renderer
                .set_textures(
                    ctx.gpu.device().graphics_queue().handle(),
                    self.pool.handle(),
                    textures_delta.set.as_slice(),
                )
                .unwrap_or_else(|e| panic!("Failed to set gui textures: {e:?}"));
        }
        let clipped_primitives = self.ctx.tessellate(shapes, pixels_per_point);

        ctx.command_buffer.begin_rendering(
            color_attachments,
            Some(depth_attachment),
            ctx.render_extent,
        );
        self.renderer.cmd_draw(
            ctx.command_buffer.handle(),
            extent,
            pixels_per_point,
            &clipped_primitives,
        )?;
        ctx.command_buffer.end_rendering();

        Ok(())
    }

    pub fn handle_events<'a>(&'a mut self, events: impl Iterator<Item = &'a GuiEvent>) {
        events.for_each(|event| {
            let _ = self.state.on_window_event(&self.window, &event.0);
        });
    }
}

fn build_ui(ctx: &egui::Context, config: &mut GpuConfigData) {
    egui::Window::new("Shader Config")
        .max_width(350.)
        .default_width(350.)
        .resizable(false)
        .show(ctx, |ui| {
            let flags = &mut config.flags;
            ui.heading("Output Override:");
            ui.horizontal(|ui| {
                checkbox(ui, flags, RenderFlags::DEBUG_COLOR, "Color");
                checkbox(ui, flags, RenderFlags::DEBUG_NORMALS, "Normals");
                checkbox(ui, flags, RenderFlags::DEBUG_TANGENTS, "Tangents");
                checkbox(ui, flags, RenderFlags::DEBUG_METALLIC, "Metallic");
                checkbox(ui, flags, RenderFlags::DEBUG_ROUGHNESS, "Roughness");
                checkbox(ui, flags, RenderFlags::DEBUG_OCCLUSION, "Occlusion");
                checkbox(ui, flags, RenderFlags::DEBUG_TEXCOORDS0, "TexCoords0");
            });
            ui.heading("Disable:");
            ui.horizontal(|ui| {
                checkbox(ui, flags, RenderFlags::DISABLE_COLOR_MAP, "Color Map");
                checkbox(ui, flags, RenderFlags::DISABLE_NORMAL_MAP, "Normal Map");
                checkbox(ui, flags, RenderFlags::DISABLE_TANGENTS, "Tangents");
                checkbox(ui, flags, RenderFlags::DISABLE_MR_MAP, "MetalRough Map");
                checkbox(ui, flags, RenderFlags::DISABLE_OCCLUSION_MAP, "AO Map");
            });
            ui.heading("Override:");
            ui.horizontal(|ui| {
                checkbox(ui, flags, RenderFlags::OVERRIDE_COLOR, "Color");
                ui.add(
                    egui::DragValue::new(&mut config.override_color.x)
                        .speed(0.01)
                        .range(0.0..=1.0)
                        .prefix("R: "),
                );
                ui.add(
                    egui::DragValue::new(&mut config.override_color.y)
                        .speed(0.01)
                        .range(0.0..=1.0)
                        .prefix("G: "),
                );
                ui.add(
                    egui::DragValue::new(&mut config.override_color.z)
                        .speed(0.01)
                        .range(0.0..=1.0)
                        .prefix("B: "),
                );
            });
            ui.horizontal(|ui| {
                checkbox(ui, flags, RenderFlags::OVERRIDE_METAL, "Metal");
                ui.add(
                    egui::DragValue::new(&mut config.override_metallic)
                        .speed(0.01)
                        .range(0.0..=1.0)
                        .prefix("V: "),
                );
                checkbox(ui, flags, RenderFlags::OVERRIDE_ROUGH, "Rough");
                ui.add(
                    egui::DragValue::new(&mut config.override_roughness)
                        .speed(0.01)
                        .range(0.0..=1.0)
                        .prefix("V: "),
                );
                checkbox(ui, flags, RenderFlags::OVERRIDE_OCCLUSION, "AO");
                ui.add(
                    egui::DragValue::new(&mut config.override_occlusion)
                        .speed(0.01)
                        .range(0.0..=1.0)
                        .prefix("V: "),
                );
            });
            ui.heading("Light:");
            ui.horizontal(|ui| {
                checkbox(ui, flags, RenderFlags::OVERRIDE_LIGHTS, "Lights");
            });
            ui.horizontal(|ui| {
                ui.label("0:");
                ui.add(
                    egui::DragValue::new(&mut config.override_light0.x)
                        .speed(0.1)
                        .range(0.0..=255.0)
                        .prefix("R: "),
                );
                ui.add(
                    egui::DragValue::new(&mut config.override_light0.y)
                        .speed(0.1)
                        .range(0.0..=255.0)
                        .prefix("G: "),
                );
                ui.add(
                    egui::DragValue::new(&mut config.override_light0.z)
                        .speed(0.1)
                        .range(0.0..=255.0)
                        .prefix("B: "),
                );
            });
            ui.horizontal(|ui| {
                ui.label("1:");
                ui.add(
                    egui::DragValue::new(&mut config.override_light1.x)
                        .speed(0.1)
                        .range(0.0..=255.0)
                        .prefix("R: "),
                );
                ui.add(
                    egui::DragValue::new(&mut config.override_light1.y)
                        .speed(0.1)
                        .range(0.0..=255.0)
                        .prefix("G: "),
                );
                ui.add(
                    egui::DragValue::new(&mut config.override_light1.z)
                        .speed(0.1)
                        .range(0.0..=255.0)
                        .prefix("B: "),
                );
            });
            ui.horizontal(|ui| {
                ui.label("2:");
                ui.add(
                    egui::DragValue::new(&mut config.override_light2.x)
                        .speed(0.1)
                        .range(0.0..=255.0)
                        .prefix("R: "),
                );
                ui.add(
                    egui::DragValue::new(&mut config.override_light2.y)
                        .speed(0.1)
                        .range(0.0..=255.0)
                        .prefix("G: "),
                );
                ui.add(
                    egui::DragValue::new(&mut config.override_light2.z)
                        .speed(0.1)
                        .range(0.0..=255.0)
                        .prefix("B: "),
                );
            });
            ui.horizontal(|ui| {
                ui.label("3:");
                ui.add(
                    egui::DragValue::new(&mut config.override_light3.x)
                        .speed(0.1)
                        .range(0.0..=255.0)
                        .prefix("R: "),
                );
                ui.add(
                    egui::DragValue::new(&mut config.override_light3.y)
                        .speed(0.1)
                        .range(0.0..=255.0)
                        .prefix("G: "),
                );
                ui.add(
                    egui::DragValue::new(&mut config.override_light3.z)
                        .speed(0.1)
                        .range(0.0..=255.0)
                        .prefix("B: "),
                );
            });
        });
}

fn checkbox(ui: &mut egui::Ui, flags: &mut u32, bit: RenderFlags, label: &str) {
    let mut temp = RenderFlags::from_bits_truncate(*flags);
    let mut value = temp.contains(bit);

    if ui.checkbox(&mut value, label).changed() {
        temp.set(bit, value);
        *flags = temp.bits();
    }
}

// fn light(ui: &mut egui::Ui, light: &mut Light, n: u32) {
//     egui::Grid::new(format!("light-{n:02}")).min_col_width(50.).max_col_width(250.).show(
//         ui,
//         |ui| {
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
//         },
//     );
// }

// fn drag_value(ui: &mut egui::Ui, value: &mut f32, label: &str, max: f32) {
//     let range = 0.0..=max;
//     let speed = max / 100.;
//     ui.horizontal(|ui| {
//         ui.label(label);
//         ui.add(egui::DragValue::new(value).speed(speed).range(range));
//     });
// }

// fn pbr_override_vec4(ui: &mut egui::Ui, flag: &mut bool, value: &mut Vec4, label: &str) {
//     egui::Grid::new(format!("override-scalar-{label}"))
//         .min_col_width(50.)
//         .max_col_width(250.)
//         .show(ui, |ui| {
//             ui.label(label);
//             ui.checkbox(flag, "Override?");
//             drag_value(ui, &mut value.x, "r", 1.);
//             drag_value(ui, &mut value.y, "g", 1.);
//             drag_value(ui, &mut value.z, "b", 1.);
//             drag_value(ui, &mut value.w, "a", 1.);
//             ui.end_row();
//         });
// }

// fn pbr_override_scalar(
//     ui: &mut egui::Ui,
//     flag: &mut bool,
//     mut value: &mut f32,
//     label: &str,
// ) -> egui::Response {
//     ui.horizontal(|ui| {
//         ui.label("Override?");
//         ui.checkbox(flag, label);
//         drag_value(ui, &mut value, "r", 1.);
//         ui.end_row();
//     })
//     .response
// }
