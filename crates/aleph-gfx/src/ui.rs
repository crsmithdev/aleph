use {
    aleph_hal::{CommandBuffer, Context },
    anyhow::Result,
    ash::vk::{self},
    imgui,
    imgui_rs_vulkan_renderer::DynamicRendering,
    imgui_winit_support::{self as imgui_winit},
    std::{fmt, sync::Arc, time},
    winit::{
        event::{Event },
        keyboard::ModifiersState,
    },
};

#[allow(dead_code)]
pub struct UiRenderer {
    context: Context,
    imgui: imgui::Context,
    platform: imgui_winit::WinitPlatform,
    renderer: imgui_rs_vulkan_renderer::Renderer,
    device: ash::Device,
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
        let context = context.clone();
        let allocator = context.allocator().clone();
        let device = context.device().clone();
        let pool = context.create_command_pool()?;
        let command_buffer = CommandBuffer::new(context.device(), pool)?;

        let mut imgui = imgui::Context::create();
        imgui.set_ini_filename(None);

        let mut platform = imgui_winit_support::WinitPlatform::new(&mut imgui);
        let dpi_mode = imgui_winit_support::HiDpiMode::Default;

        platform.attach_window(imgui.io_mut(), context.window(), dpi_mode);
        imgui
            .fonts()
            .add_font(&[imgui::FontSource::DefaultFontData { config: None }]);

        let renderer = imgui_rs_vulkan_renderer::Renderer::with_gpu_allocator(
            allocator.inner.clone(),
            device.inner,
            *context.queue(),
            pool,
            DynamicRendering {
                color_attachment_format: vk::Format::B8G8R8A8_UNORM,
                depth_attachment_format: None,
            },
            &mut imgui,
            Some(imgui_rs_vulkan_renderer::Options {
                in_flight_frames: 2,
                ..Default::default()
            }),
        )?;
        let device2 = context.device().inner.clone();

        Ok(UiRenderer {
            context: context.clone(),
            imgui,
            platform,
            renderer,
            device: device2,
            command_buffer,
            window: context.window().clone(),
            queue: *context.queue(),
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
        command_buffer: &CommandBuffer,
        image_view: &vk::ImageView,
    ) -> Result<()> {
        let UiRenderer {
            imgui,
            platform,
            renderer,
            context,
            ..
        } = self;
        // let image_view = context.swapchain_mut().image_view(frame.index);
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

        // command_buffer.begin()?;
        command_buffer.begin_rendering(image_view, extent)?;

        renderer.cmd_draw(command_buffer.inner, draw_data)?;

        command_buffer.end_rendering()?;
        // command_buffer.end()?;

        Ok(())
    }

    pub fn handle_event(&mut self, event: Event<()>) {
        self.platform.handle_event(self.imgui.io_mut(), &self.window, &event);      
    }
}

    // pub fn handle_window_event(&mut self, event: WindowEvent) {
    //     use winit::event::{ElementState::*, MouseScrollDelta::*, WindowEvent::*, *};

    //     let io = self.imgui.io_mut();

    //     match event {
    //         CursorMoved { position, .. } => {
    //             io.mouse_pos = [position.x as f32, position.y as f32];
    //             io.key_ctrl = self.modifiers.control_key();
    //             io.key_shift = self.modifiers.shift_key();
    //             io.key_alt = self.modifiers.alt_key();
    //         }
    //         MouseInput { state, button, .. } => match button {
    //             MouseButton::Left => io.mouse_down[0] = state == Pressed,
    //             MouseButton::Right => io.mouse_down[1] = state == Pressed,
    //             MouseButton::Middle => io.mouse_down[2] = state == Pressed,
    //             _ => {}
    //         },
    //         MouseWheel {
    //             delta: LineDelta(x, y),
    //             ..
    //         } => {
    //             io.mouse_wheel_h += x;
    //             io.mouse_wheel += y;
    //         }
    //         ModifiersChanged(modifiers) => {
    //             self.modifiers = modifiers.state();
    //         }
    //         _ => {}
    //     }
    // fn attachment_info
    //     view: vk::ImageView,
    //     clear: Option<vk::ClearValue>,
    //     layout: vk::ImageLayout,
    //  -> vk::RenderingAttachmentInfo<'static> {
    //     let load_op = if clear.is_some() {
    //         vk::AttachmentLoadOp::CLEAR
    //     } else {
    //         vk::AttachmentLoadOp::LOAD
    //     };
    //     let mut result = vk::RenderingAttachmentInfo::default()
    //         .image_view(view)
    //         .image_layout(layout)
    //         .load_op(load_op)
    //         .store_op(vk::AttachmentStoreOp::STORE);

    //     if let Some(clear) = clear {
    //         result = result.clear_value(clear);
    //     }

    //     result
    // }