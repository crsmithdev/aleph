use {
    aleph_vk::{CommandBuffer, CommandPool, Extent2D, Format, Gpu},
    anyhow::Result,
    egui, egui_ash_renderer as egui_renderer, egui_extras, egui_winit, gpu_allocator as ga,
    std::{
        sync::{Arc, Mutex},
    },
};

pub struct Gui {
    pub egui_ctx: egui::Context,
    pub egui_winit: egui_winit::State,
    pub egui_renderer: egui_renderer::Renderer,
    pool: CommandPool,
    window: Arc<winit::window::Window>,
    textures_to_free: Option<Vec<egui::TextureId>>,
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

            egui_renderer::Renderer::with_gpu_allocator(
                Arc::new(Mutex::new(allocator)),
                device.handle().clone(),
                egui_renderer::DynamicRendering {
                    color_attachment_format: Format::B8G8R8A8_SRGB,
                    depth_attachment_format: Some(Format::D32_SFLOAT),
                },
                egui_renderer::Options {
                    srgb_framebuffer: true,
                    ..Default::default()
                },
            )
        }?;

        Ok(Self {
            egui_ctx,
            egui_winit,
            egui_renderer: renderer,
            window: window.clone(),
            textures_to_free: None,
            pool,
        })
    }

    pub fn draw(&mut self, gpu: &Gpu, cmd: &CommandBuffer, extent: Extent2D) -> Result<()> {
        let raw_input = self.egui_winit.take_egui_input(&self.window);

        let egui::FullOutput {
            platform_output,
            textures_delta,
            shapes,
            pixels_per_point,
            ..
        } = self.egui_ctx.run(raw_input, |ctx| {
            build_ui(ctx);
        });

        self.egui_winit
            .handle_platform_output(&self.window, platform_output);

        if !textures_delta.free.is_empty() {
            self.textures_to_free = Some(textures_delta.free.clone());
        }

        if !textures_delta.set.is_empty() {
            self.egui_renderer
                .set_textures(
                    gpu.device().queue().handle(),
                    self.pool.handle(),
                    textures_delta.set.as_slice(),
                )
                .expect("Failed to set textures");
        }
        let clipped_primitives = self.egui_ctx.tessellate(shapes, pixels_per_point);
        self.egui_renderer
            .cmd_draw(cmd.handle(), extent, pixels_per_point, &clipped_primitives)?;

        Ok(())
    }

    pub fn on_window_event(&mut self, event: &winit::event::WindowEvent) {
        let _ = self.egui_winit.on_window_event(&self.window, event);
    }
}

fn build_ui(ctx: &egui::Context) { egui::Window::new("Demo texture").show(ctx, |_| {}); }
