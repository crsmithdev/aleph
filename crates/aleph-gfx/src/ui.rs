use {
    aleph_hal::{CommandBuffer, Context},
    anyhow::Result,
    ash::vk::{self},
    imgui,
    imgui_rs_vulkan_renderer as imgui_vk,
    imgui_winit_support as imgui_winit,
    std::{fmt, sync::Arc, time},
    winit::{event::Event, keyboard::ModifiersState},
};

#[allow(dead_code)]
pub struct UiRenderer {
    imgui: imgui::Context,
    platform: imgui_winit::WinitPlatform,
    renderer: imgui_vk::Renderer,
    command_buffer: CommandBuffer,
    queue: vk::Queue,
    window: Arc<winit::window::Window>,
    modifiers: ModifiersState,
    last_delta_update: time::Instant,
}

impl fmt::Debug for UiRenderer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UI").finish_non_exhaustive()
    }
}

impl UiRenderer {
    pub fn new(context: &Context) -> Result<Self> {
        let allocator = context.memory_allocator().clone();
        let device = context.device().clone();
        let pool = context.create_command_pool()?;
        let command_buffer = device.create_command_buffer(pool)?;

        let mut imgui = imgui::Context::create();
        let mut platform = imgui_winit::WinitPlatform::new(&mut imgui);
        let dpi_mode = imgui_winit::HiDpiMode::Default;

        platform.attach_window(imgui.io_mut(), context.window(), dpi_mode);
        imgui
            .fonts()
            .add_font(&[imgui::FontSource::DefaultFontData { config: None }]);

        let renderer = imgui_vk::Renderer::with_gpu_allocator(
            allocator.inner().clone(),
            context.device().handle().clone(),
            context.queue().handle(),
            pool,
            imgui_vk::DynamicRendering {
                color_attachment_format: vk::Format::B8G8R8A8_UNORM,
                depth_attachment_format: None,
            },
            &mut imgui,
            Some(imgui_vk::Options {
                in_flight_frames: 2,
                ..Default::default()
            }),
        )?;

        Ok(UiRenderer {
            imgui,
            platform,
            renderer,
            command_buffer,
            window: context.window().clone(),
            queue: context.queue().handle(),
            last_delta_update: time::Instant::now(),
            modifiers: ModifiersState::empty(),
        })
    }

    pub fn update_delta_time(&mut self) {
        let now = time::Instant::now();
        let delta = now.duration_since(self.last_delta_update);
        self.imgui.io_mut().delta_time = delta.as_secs_f32();
        self.last_delta_update = now;
    }

    pub fn render(
        &mut self,
        context: &Context,
        command_buffer: &CommandBuffer,
        image_view: &vk::ImageView,
    ) -> Result<()> {
        let UiRenderer {
            imgui,
            platform,
            renderer,
            ..
        } = self;
        let extent = context.swapchain().extent();

        platform.prepare_frame(imgui.io_mut(), &self.window)?;
        let ui = imgui.frame();

        ui.window("background")
            .size([500.0, 200.0], imgui::Condition::Always)
            .build(|| {
                ui.text("Hello World!");
            });

        platform.prepare_render(ui, &self.window);
        let draw_data = imgui.render();

        command_buffer.begin_rendering(image_view, extent)?;
        renderer.cmd_draw(command_buffer.handle(), draw_data)?;
        command_buffer.end_rendering()?;

        Ok(())
    }

    pub fn handle_event(&mut self, event: Event<()>) {
        self.platform
            .handle_event(self.imgui.io_mut(), &self.window, &event);
    }
}
