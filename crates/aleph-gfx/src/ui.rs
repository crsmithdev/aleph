use {
    aleph_hal::{RenderBackend, Swapchain},
    anyhow::Result,
    ash::vk::{self},
    imgui,
    imgui_rs_vulkan_renderer::{self as imgui_renderer, DynamicRendering},
    imgui_winit_support::{self as imgui_winit, HiDpiMode},
    std::{
        fmt,
        sync::{Arc, Mutex},
    },
    winit::event::{Event, WindowEvent},
};

#[allow(dead_code)]
pub struct UI {
    context: imgui::Context,
    platform: imgui_winit::WinitPlatform,
    renderer: imgui_rs_vulkan_renderer::Renderer,
    device: ash::Device,
    command_buffer: vk::CommandBuffer,
    queue: vk::Queue,
}

impl fmt::Debug for UI {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UI").finish_non_exhaustive()
    }
}

impl UI {
    pub fn new(backend: &RenderBackend, window: &winit::window::Window) -> Result<Self> {
        let mut context = imgui::Context::create();
        context.set_ini_filename(None);

        let mut platform = imgui_winit::WinitPlatform::new(&mut context);
        platform.attach_window(context.io_mut(), window, HiDpiMode::Default);
        let device: ash::Device = backend.device.inner.clone();
        let device2: ash::Device = backend.device.inner.clone();
        let queue = *backend.queue();
        let command_pool = backend.create_command_pool()?;
        let command_buffer = backend.create_command_buffer(command_pool)?;
        let hidpi_factor = platform.hidpi_factor();
        let font_size = (13.0 * hidpi_factor) as f32;
        context.fonts().add_font(&[
            imgui::FontSource::DefaultFontData {
                config: Some(imgui::FontConfig {
                    size_pixels: font_size,
                    ..imgui::FontConfig::default()
                }),
            },
            imgui::FontSource::TtfData {
                data: include_bytes!("../../../resources/arial.ttf"),
                size_pixels: font_size,
                config: Some(imgui::FontConfig {
                    rasterizer_multiply: 1.75,
                    glyph_ranges: imgui::FontGlyphRanges::japanese(),
                    ..imgui::FontConfig::default()
                }),
            },
        ]);
        context.io_mut().font_global_scale = (1.0 / hidpi_factor) as f32;
        let renderer = imgui_renderer::Renderer::with_gpu_allocator(
            backend.allocator().inner.clone(),
            device,
            queue,
            command_pool,
            imgui_renderer::DynamicRendering {
                color_attachment_format: vk::Format::B8G8R8A8_UNORM,
                depth_attachment_format: None,
            },
            &mut context,
            Some(imgui_renderer::Options {
                in_flight_frames: 2,
                ..Default::default()
            }),
        )?;
            Ok(Self {
            context,
            platform,
            renderer,
            device: device2,
            command_buffer,
            queue,
        })
    }

    pub fn render(&mut self, window: &winit::window::Window) -> Result<()> {
    //     unsafe {
    //         self.device.reset_command_buffer(
    //             self.command_buffer,
    //             vk::CommandBufferResetFlags::default(),
    //         )?;
    //         let info = &vk::CommandBufferBeginInfo::default()
    //             .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT);
    //         self.device
    //             .begin_command_buffer(self.command_buffer, info)?;
    //     }

    //     self.platform.prepare_frame(self.context.io_mut(), window)?;
    //     let ui = self.context.frame();

    //     ui.window("Hello world")
    //         .size([300.0, 100.0], imgui::Condition::Always)
    //         .build(|| {
    //             ui.text("Hello world!");
    //         });

    //     self.platform.prepare_render(ui, &window);
    //     let draw_data = self.context.render();
        
    //     let color_attachment_info = vk::RenderingAttachmentInfo::default()
    //     .clear_value(vk::ClearValue {
    //         color: vk::ClearColorValue {
    //             float32: [0.0, 0.0, 0.0, 1.0],
    //         },
    //     })
    //     .image_layout(vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL)
    //     .image_view(self.swapchain.image_views()[frame_index])
    //     .load_op(vk::AttachmentLoadOp::CLEAR)
    //     .store_op(vk::AttachmentStoreOp::STORE);

    // let rendering_info = vk::RenderingInfo::default()
    //     .color_attachments(std::slice::from_ref(&color_attachment_info))
    //     .layer_count(1)
    //     .render_area(vk::Rect2D {
    //         offset: vk::Offset2D { x: 0, y: 0 },
    //         extent,
    //     });

    // unsafe {
    //     self.context
    //         .dynamic_rendering()
    //         .cmd_begin_rendering(command_buffer, &rendering_info)
    // };

    //     self.renderer.cmd_draw(self.command_buffer, draw_data)?;

        Ok(())
    }

    pub fn handle_event(&mut self, window: &winit::window::Window, event: Event<()>) {
        self.platform
            .handle_event(self.context.io_mut(), window, &event);
    }
}
