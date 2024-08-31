use crate::{
    core::Plugin,
    gfx::{device::Device, instance::Instance, surface::Surface},
};
use anyhow::Result;
use physical_device::PhysicalDevices;
use std::{cell::OnceCell, sync::Arc};
use winit::window::Window;
pub mod debug;
pub mod device;
pub mod instance;
pub mod physical_device;
pub mod surface;
pub struct GraphicsPlugin {
    backend: OnceCell<RenderBackend>,
}

impl GraphicsPlugin {
    pub fn new() -> Self {
        Self {
            backend: OnceCell::new(),
        }
    }
}

impl Plugin for GraphicsPlugin {
    fn init(&self, window: Arc<Window>) -> Result<()> {
        let backend = RenderBackend::new(window.clone())?;
        let _ = self.backend.set(backend);
        Ok(())
    }

    fn update(&self) {
        todo!()
    }

    fn cleanup(&self) {
        todo!()
    }
}
pub struct RenderBackend {}

impl RenderBackend {
    pub fn new(window: Arc<Window>) -> Result<Self> {
        unsafe { Self::init_vulkan(window) }?;
        Ok(Self {})
    }

    unsafe fn init_vulkan(window: Arc<Window>) -> Result<RenderBackend> {
        log::info!("Initializing Vulkan");

        let instance = Instance::builder(window.clone()).build()?;
        log::info!("Created instance: {instance:?}");

        let surface = Surface::create(instance.clone(), window.clone())?;
        log::info!("Created surface: {surface:?}");

        let physical_devices = instance.get_physical_devices()?;
        let physical_device = physical_devices.select_default()?;
        let _device = Device::create(instance, physical_device);

        // let queue_family_index = queue_family_index as u32;
        // let device_extension_names_raw = [khr::swapchain::NAME.as_ptr()];
        // let features = vk::PhysicalDeviceFeatures {
        //     shader_clip_distance: 1,
        //     ..Default::default()
        // };
        // let priorities = [1.0];

        // let queue_info = vk::DeviceQueueCreateInfo::default()
        //     .queue_family_index(queue_family_index)
        //     .queue_priorities(&priorities);

        // let device_create_info = vk::DeviceCreateInfo::default()
        //     .queue_create_infos(std::slice::from_ref(&queue_info))
        //     .enabled_extension_names(&device_extension_names_raw)
        //     .enabled_features(&features);

        // let device: ash::Device = unsafe {
        //     instance
        //         .raw
        //         .create_device(physical_device, &device_create_info, None)
        //         .unwrap()
        // };

        // let present_queue = unsafe { device.get_device_queue(queue_family_index, 0) };

        // let surface_format = unsafe {
        //     surface.fns
        //         .get_physical_device_surface_formats(pdevice, surface.raw)
        //         .unwrap()[0]
        // };

        // let surface_capabilities = unsafe {
        //     surface.fns
        //         .get_physical_device_surface_capabilities(pdevice, surface.raw)
        //         .unwrap()
        // };

        // log::info!("Device: {:? }", device.handle());

        // let mut desired_image_count = surface_capabilities.min_image_count + 1;
        // if surface_capabilities.max_image_count > 0
        //     && desired_image_count > surface_capabilities.max_image_count
        // {
        //     desired_image_count = surface_capabilities.max_image_count;
        // }
        // let surface_resolution = match surface_capabilities.current_extent.width {
        //     u32::MAX => vk::Extent2D {
        //         width: window_width,
        //         height: window_height,
        //     },
        //     _ => surface_capabilities.current_extent,
        // };
        // let pre_transform = if surface_capabilities
        //     .supported_transforms
        //     .contains(vk::SurfaceTransformFlagsKHR::IDENTITY)
        // {
        //     vk::SurfaceTransformFlagsKHR::IDENTITY
        // } else {
        //     surface_capabilities.current_transform
        // };
        // let present_modes = surface.fns
        //     .get_physical_device_surface_present_modes(pdevice, surface.raw )
        //     .unwrap();
        // let present_mode = present_modes
        //     .iter()
        //     .cloned()
        //     .find(|&mode| mode == vk::PresentModeKHR::MAILBOX)
        //     .unwrap_or(vk::PresentModeKHR::FIFO);
        // let swapchain_loader = khr::swapchain::Device::new(&instance.raw, &device);

        // let swapchain_create_info = vk::SwapchainCreateInfoKHR::default()
        //     .surface(surface.raw)
        //     .min_image_count(desired_image_count)
        //     .image_color_space(surface_format.color_space)
        //     .image_format(surface_format.format)
        //     .image_extent(surface_resolution)
        //     .image_usage(vk::ImageUsageFlags::COLOR_ATTACHMENT)
        //     .image_sharing_mode(vk::SharingMode::EXCLUSIVE)
        //     .pre_transform(pre_transform)
        //     .composite_alpha(vk::CompositeAlphaFlagsKHR::OPAQUE)
        //     .present_mode(present_mode)
        //     .clipped(true)
        //     .image_array_layers(1);

        // let swapchain = swapchain_loader
        //     .create_swapchain(&swapchain_create_info, None)
        //     .unwrap();

        // log::info!("Swapchain: {:?}", swapchain.as_raw());

        Ok(RenderBackend {})
    }
}
