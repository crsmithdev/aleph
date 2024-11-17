use {
    crate::vk::allocator::Allocator,
    anyhow::Result,
    ash::{
        khr,
        vk::{self},
    },
    std::sync::Arc,
    vk::Handle,
};

pub const SWAPCHAIN_IMAGES: u32 = 2;

pub struct Frame {
    pub index: usize,
    pub swapchain_semaphore: vk::Semaphore,
    pub render_semaphore: vk::Semaphore,
    pub fence: vk::Fence,
    pub command_pool: vk::CommandPool,
    pub command_buffer: vk::CommandBuffer,
}

pub struct SwapchainDesc {
    pub format: vk::Format,
    pub extent: vk::Extent2D,
    pub vsync: bool,
    pub color_space: vk::ColorSpaceKHR,
}

pub struct SwapchainInfo<'a> {
    pub instance: &'a ash::Instance,
    pub physical_device: &'a vk::PhysicalDevice,
    pub device: &'a ash::Device,
    pub queue_family_index: u32,
    pub allocator: &'a Arc<Allocator>,
    pub queue: &'a vk::Queue,
    pub surface: &'a vk::SurfaceKHR,
    pub surface_fns: &'a khr::surface::Instance,
    pub extent: vk::Extent2D,
    pub format: vk::Format,
    pub color_space: vk::ColorSpaceKHR,
    pub vsync: bool,
}

pub struct Swapchain {
    pub inner: vk::SwapchainKHR,
    pub instance: ash::Instance,
    pub physical_device: vk::PhysicalDevice,
    pub allocator: Arc<Allocator>,
    pub device: ash::Device,
    pub surface: vk::SurfaceKHR,
    surface_fns: khr::surface::Instance,
    pub fns: khr::swapchain::Device,
    pub queue: vk::Queue,
    pub queue_family_index: u32,
    pub image_views: Vec<vk::ImageView>,
    pub images: Vec<vk::Image>,
    pub format: vk::Format,
    pub extent: vk::Extent2D,
    pub vsync: bool,
    pub color_space: vk::ColorSpaceKHR,
}

impl Swapchain {
    pub(crate) fn new(info: &SwapchainInfo) -> Result<Swapchain> {
        let indices = &[info.queue_family_index];
        let capabilities = unsafe {
            info.surface_fns
                .get_physical_device_surface_capabilities(*info.physical_device, *info.surface)
        }?;
        let surface_resolution = match capabilities.current_extent.width {
            std::u32::MAX => info.extent,
            _ => capabilities.current_extent,
        };
        let present_mode = match info.vsync {
            true => vk::PresentModeKHR::FIFO_RELAXED,
            false => vk::PresentModeKHR::MAILBOX,
        };

        let swapchain_info = vk::SwapchainCreateInfoKHR::default()
            .surface(*info.surface)
            .min_image_count(SWAPCHAIN_IMAGES)
            .image_color_space(info.color_space)
            .image_format(info.format)
            .image_extent(surface_resolution)
            .image_sharing_mode(vk::SharingMode::EXCLUSIVE)
            .pre_transform(vk::SurfaceTransformFlagsKHR::IDENTITY)
            .composite_alpha(vk::CompositeAlphaFlagsKHR::OPAQUE)
            .present_mode(present_mode)
            .clipped(true)
            .image_usage(vk::ImageUsageFlags::COLOR_ATTACHMENT | vk::ImageUsageFlags::TRANSFER_DST)
            .queue_family_indices(indices)
            .image_array_layers(1);
        let loader = khr::swapchain::Device::new(info.instance, info.device);
        let swapchain = unsafe { loader.create_swapchain(&swapchain_info, None) }.unwrap();

        let images = unsafe { loader.get_swapchain_images(swapchain)? };
        let subresource_range = vk::ImageSubresourceRange::default()
            .aspect_mask(vk::ImageAspectFlags::COLOR)
            .level_count(1)
            .layer_count(1);
        let image_views: Vec<vk::ImageView> = images
            .iter()
            .map(|image| {
                let image_view_info = vk::ImageViewCreateInfo::default()
                    .image(*image)
                    .view_type(vk::ImageViewType::TYPE_2D)
                    .format(vk::Format::B8G8R8A8_UNORM)
                    .subresource_range(subresource_range);
                unsafe {
                    info.device
                        .create_image_view(&image_view_info, None)
                        .expect("Failed to create imageview")
                }
            })
            .collect();

        Ok(Swapchain {
            inner: swapchain,
            fns: loader,
            device: info.device.clone(),
            instance: info.instance.clone(),
            allocator: info.allocator.clone(),
            physical_device: info.physical_device.clone(),
            queue: info.queue.clone(),
            queue_family_index: info.queue_family_index,
            format: info.format,
            extent: surface_resolution,
            vsync: info.vsync,
            color_space: info.color_space,
            surface: info.surface.clone(),
            surface_fns: info.surface_fns.clone(),
            image_views,
            images,
        })
    }

    pub fn destroy(&self) {
        log::info!("Destroying swapchain: {:?}", self);
        unsafe {
            self.fns.destroy_swapchain(self.inner, None);
            self.image_views
                .iter()
                .for_each(|v| self.device.destroy_image_view(*v, None));
        };
    }

    pub fn recreate(&mut self, extent: vk::Extent2D) -> Result<()> {
        self.destroy();

        let info = SwapchainInfo {
            allocator: &self.allocator,
            device: &self.device,
            physical_device: &self.physical_device,
            queue_family_index: self.queue_family_index,
            instance: &self.instance,
            surface: &self.surface,
            extent,
            format: self.format,
            color_space: self.color_space,
            vsync: self.vsync,
            surface_fns: &self.surface_fns,
            queue: &self.queue,
        };

        match Self::new(&info) {
            Ok(swapchain) => {
                *self = swapchain;
                log::info!("Recrated swapchain: {:?}", self);
                Ok(())
            }
            Err(e) => Err(e),
        }
    }

    pub fn queue_present(
        &mut self,
        wait_semaphores: &[vk::Semaphore],
        indices: &[u32],
    ) -> Result<()> {
        let swapchains = &[self.inner];
        let present_info = vk::PresentInfoKHR::default()
            .wait_semaphores(wait_semaphores)
            .swapchains(swapchains)
            .image_indices(indices);
        let result = unsafe { self.fns.queue_present(self.queue, &present_info) };
        let _ = match result {
            Ok(_) => Ok(()),
            Err(err) => match err {
                vk::Result::ERROR_OUT_OF_DATE_KHR | vk::Result::SUBOPTIMAL_KHR => {
                    self.recreate(self.extent)?;
                    Ok(())
                }
                _ => Err(err),
            },
        };
        Ok(())
    }
}

impl Drop for Swapchain {
    fn drop(&mut self) {
        // self.destroy();
    }
}

impl std::fmt::Debug for Swapchain {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.debug_struct("Swapchain")
            .field("inner", &format_args!("{:x}", self.inner.as_raw()))
            .finish()
    }
}
