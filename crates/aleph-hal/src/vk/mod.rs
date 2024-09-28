use {
    crate::vk::{
        command_buffer::CommandBuffer,
        device::Device,
        instance::Instance,
        physical_device::PhysicalDevice,
        render_pass::RenderPass,
        surface::Surface,
        swapchain::{Swapchain, SwapchainDesc},
    },
    anyhow::Result,
    ash::vk,
    physical_device::PhysicalDevices,
    std::{fmt, sync::Arc},
    winit::window::Window,
};

pub mod buffer;
pub mod command_buffer;
pub mod debug;
pub mod device;
pub mod instance;
pub mod physical_device;
pub mod pipeline;
pub mod queue;
pub mod render_pass;
pub mod shader;
pub mod surface;
pub mod swapchain;

#[derive(Clone, Debug, Copy)]
pub struct Vertex {
    pub pos: [f32; 4],
    pub color: [f32; 4],
}

pub struct RenderBackend {
    pub instance: Arc<Instance>,
    pub physical_device: Arc<PhysicalDevice>,
    pub surface: Arc<Surface>,
    pub swapchain: Arc<Swapchain>,
    pub device: Arc<Device>,
    pub render_pass: Arc<RenderPass>,
    pub draw_commands_reuse_fence: vk::Fence,
    pub present_complete_semaphore: vk::Semaphore,
    pub rendering_complete_semaphore: vk::Semaphore,
}

impl fmt::Debug for RenderBackend {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RenderBackend")
            // .field("instance: {}", self.instance)///  &format_args!("{:?}", self.instance))
            .finish_non_exhaustive()
    }
}

impl RenderBackend {
    pub fn new(window: Arc<Window>) -> Result<Arc<Self>> {
        unsafe { Self::init_vulkan(window) }
    }

    unsafe fn init_vulkan(window: Arc<Window>) -> Result<Arc<RenderBackend>> {
        log::info!("Initializing Vulkan");

        let instance = Instance::builder(window.clone()).build()?;
        log::info!("Created instance: {instance:?}");

        let surface = Surface::create(instance.clone(), window.clone())?;
        log::info!("Created surface: {surface:?}");

        let physical_devices = instance.get_physical_devices()?;
        let physical_device = physical_devices.select_default()?;
        let device = Device::create(&instance, &physical_device.clone())?;
        log::info!("Created device: {device:?}");

        let format = vk::Format::B8G8R8A8_UNORM;
        let color_space = vk::ColorSpaceKHR::SRGB_NONLINEAR;

        let extent = vk::Extent2D {
            width: 640,
            height: 480,
        };
        let swapchain = Swapchain::create(
            &device,
            &surface,
            SwapchainDesc {
                format,
                color_space,
                extent,
                vsync: false,
            },
        )?;
        log::info!("Created swapchain: {swapchain:?}");

        let render_pass = device.create_render_pass(&swapchain)?;
        log::info!("Created render pass: {render_pass:?}");

        let draw_commands_reuse_fence = device.create_fence(true)?;
        let present_complete_semaphore = device.create_semaphore()?;
        let rendering_complete_semaphore = device.create_semaphore()?;
        log::info!("Created sync structures:");
        log::info!("draw_commands_reuse_fence: {draw_commands_reuse_fence:?}");
        log::info!("present_complete_semaphore: {present_complete_semaphore:?}");
        log::info!("rendering_complete_semaphore: {rendering_complete_semaphore:?}");

        Ok(Arc::new(RenderBackend {
            instance,
            physical_device,
            surface,
            device,
            swapchain,
            render_pass,
            draw_commands_reuse_fence,
            present_complete_semaphore,
            rendering_complete_semaphore,
        }))
    }
}
