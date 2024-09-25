use {
    crate::vk::{
        device::Device,
        instance::Instance,
        physical_device::PhysicalDevice,
        surface::Surface,
        swapchain::{Swapchain, SwapchainProperties},
    },
    anyhow::Result,
    ash::vk,
    physical_device::PhysicalDevices,
    std::sync::Arc,
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
pub mod renderpass;
pub mod shader;
pub mod surface;
pub mod swapchain;

pub struct RenderBackend {
    pub instance: Arc<Instance>,
    pub physical_device: Arc<PhysicalDevice>,
    pub surface: Arc<Surface>,
    pub swapchain: Arc<Swapchain>,
    pub device: Arc<Device>,
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
        let device = Device::create(&instance, &physical_device)?;
        log::info!("Created device: {device:?}");

        let surface_formats = swapchain::Swapchain::enumerate_surface_formats(&device, &surface)?;
        let preferred = vk::SurfaceFormatKHR {
            format: vk::Format::B8G8R8A8_UNORM,
            color_space: vk::ColorSpaceKHR::SRGB_NONLINEAR,
        };

        let format = if surface_formats.contains(&preferred) {
            Some(preferred)
        } else {
            None
        };

        let swapchain = Swapchain::new(
            &device,
            &surface,
            SwapchainProperties {
                format: format.unwrap(),
                dims: vk::Extent2D {
                    width: 640,
                    height: 480,
                },
                vsync: false,
            },
        )?;

        log::info!("Created swapchain: {swapchain:?}");
        let backend = RenderBackend {
            instance: instance.clone(),
            physical_device: physical_device.clone(),
            surface,
            device,
            swapchain,
        };

        Ok(Arc::new(backend))
    }
}
