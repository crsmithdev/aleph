use {
    aleph_hal::{CommandBuffer, Context, Device, Queue},
    anyhow::Result,
    ash::vk,
    derive_more::Debug,
    imgui,
    imgui_rs_vulkan_renderer as imgui_renderer,
    imgui_winit_support as imgui_winit,
    std::{sync::Arc, time},
    winit,
};

#[allow(dead_code)]
#[derive(Debug)]
pub struct UiRenderer {
    context: Context,
    imgui: imgui::Context,
    platform: imgui_winit::WinitPlatform,
    #[debug("...")]
    renderer: imgui_rs_vulkan_renderer::Renderer,
    device: Device,
    command_buffer: CommandBuffer,
    queue: Queue,
    window: Arc<winit::window::Window>,
    modifiers: winit::keyboard::ModifiersState,
    last_update: time::Instant,
}

impl UiRenderer {
    pub fn new(context: &Context) -> Result<Self> {
        let pool = context.create_command_pool()?;
        let command_buffer = CommandBuffer::new(context.device(), pool)?;
        let mut imgui = imgui::Context::create();
        let mut platform = imgui_winit_support::WinitPlatform::new(&mut imgui);

        platform.attach_window(
            imgui.io_mut(),
            context.window(),
            imgui_winit_support::HiDpiMode::Default,
        );
        imgui
            .fonts()
            .add_font(&[imgui::FontSource::DefaultFontData { config: None }]);

        let renderer = imgui_renderer::Renderer::with_gpu_allocator(
            context.allocator().inner().clone(),
            context.device().handle().clone(),
            context.queue().handle(),
            pool,
            imgui_renderer::DynamicRendering {
                color_attachment_format: vk::Format::B8G8R8A8_UNORM,
                depth_attachment_format: None,
            },
            &mut imgui,
            Some(imgui_rs_vulkan_renderer::Options {
                in_flight_frames: context.swapchain().in_flight_frames(),
                ..Default::default()
            }),
        )?;

        Ok(UiRenderer {
            imgui,
            platform,
            renderer,
            command_buffer,
            context: context.clone(),
            device: context.device().clone(),
            window: context.window().clone(),
            queue: context.queue().clone(),
            last_update: time::Instant::now(),
            modifiers: winit::keyboard::ModifiersState::empty(),
        })
    }

    pub fn update_delta_time(&mut self) {
        let now = time::Instant::now();
        self.imgui.io_mut().delta_time = now.duration_since(self.last_update).as_secs_f32();
        self.last_update = now;
    }

    pub fn render(&mut self, command_buffer: &CommandBuffer) -> Result<()> {
        let UiRenderer { imgui, context, .. } = self;

        let image_view = context.swapchain_mut().current_image_view();
        let extent = context.swapchain().extent();
        let color_attachment_info = &[vk::RenderingAttachmentInfo::default()
            .image_view(image_view)
            .image_layout(vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL)
            .load_op(vk::AttachmentLoadOp::DONT_CARE)
            .store_op(vk::AttachmentStoreOp::STORE)
            .clear_value(vk::ClearValue {
                color: vk::ClearColorValue { float32: [1.0; 4] },
            })];

        let draw_data = {
            self.platform.prepare_frame(imgui.io_mut(), &self.window)?;
            let ui = imgui.frame();
            ui.window("Window")
                .size([500.0, 200.0], imgui::Condition::Always)
                .build(|| {
                    ui.text("...");
                });
            self.imgui.render()
        };

        command_buffer.begin_rendering2(color_attachment_info, None, extent)?;
        self.renderer.cmd_draw(command_buffer.inner, draw_data)?;
        command_buffer.end_rendering()?;

        Ok(())
    }

    pub fn handle_event(&mut self, event: winit::event::Event<()>) {
        self.platform
            .handle_event(self.imgui.io_mut(), &self.window, &event);
    }
}
