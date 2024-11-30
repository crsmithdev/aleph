use {
    crate::vk::{Device, Instance, Queue, Surface},
    aleph_core::constants::VK_TIMEOUT_NS,
    anyhow::Result,
    ash::{
        khr,
        vk::{self, Extent2D},
    },
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
#[derive(Clone, Copy)]
pub struct SwapchainInfo {
    pub extent: vk::Extent2D,
    pub format: vk::Format,
    pub color_space: vk::ColorSpaceKHR,
    pub vsync: bool,
}

#[derive(Clone)]
pub struct Swapchain {
    inner: vk::SwapchainKHR,
    loader: khr::swapchain::Device,
    queue: crate::vk::Queue,
    info: SwapchainInfo,
    image_views: Vec<vk::ImageView>,
    images: Vec<vk::Image>,
}

impl Swapchain {
    pub fn new(
        instance: &Instance,
        device: &Device,
        surface: &Surface,
        queue: &Queue,
        info: &SwapchainInfo,
    ) -> Result<Self> {
        let indices = [queue.family_index];
        let capabilities: vk::SurfaceCapabilitiesKHR = unsafe {
            surface
                .loader
                .get_physical_device_surface_capabilities(device.physical_device, **surface)
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
            .surface(**surface)
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
            .queue_family_indices(&indices)
            .image_array_layers(1);
        let loader = khr::swapchain::Device::new(instance, &device);
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
                    device
                        .create_image_view(&image_view_info, None)
                        .expect("Failed to create imageview")
                }
            })
            .collect();
        Ok(Swapchain {
            inner: swapchain,
            loader,
            info: *info,
            image_views,
            images,
            queue: queue.clone(),
        })
    }

    pub fn format(&self) -> vk::Format {
        self.info.format
    }

    pub fn in_flight_frames(&self) -> u32 {
        SWAPCHAIN_IMAGES
    }

    pub fn extent(&self) -> vk::Extent2D {
        self.info.extent
    }

    pub fn images(&self) -> &[vk::Image] {
        &self.images
    }

    pub fn image_views(&self) -> &[vk::ImageView] {
        &self.image_views
    }
}

impl Swapchain {
    fn destroy(&self, device: &Device) {
        log::info!("Destroying swapchain: {:?}", self);
        unsafe {
            self.loader.destroy_swapchain(self.inner, None);
            self.image_views
                .iter()
                .for_each(|v| device.destroy_image_view(*v, None));
        };
    }

    fn rebuild(
        &mut self,
        instance: &Instance,
        device: &Device,
        extent: Extent2D,
        surface: &Surface,
    ) -> Result<()> {
        log::debug!("Rebuilding swapchain");

        self.destroy(device);
        let info = SwapchainInfo {
            extent,
            format: self.info.format,
            color_space: self.info.color_space,
            vsync: self.info.vsync,
        };

        match Self::new(instance, device, surface, &self.queue, &info) {
            Ok(swapchain) => {
                *self = swapchain;
                log::info!("Recrated swapchain: {:?}", self);
                Ok(())
            }
            Err(e) => Err(e),
        }
    }

    pub fn next_image(&mut self, semaphore: vk::Semaphore, fence: vk::Fence) -> Result<(u32, bool)> {
        match unsafe {
            self.loader
                .acquire_next_image(self.inner, VK_TIMEOUT_NS, semaphore, fence)
        } {
            Ok((index, needs_rebuild)) => Ok((index, needs_rebuild)),
            Err(err) => Err(err.into()),
        }
    }

    pub fn present(&mut self, wait_semaphores: &[vk::Semaphore], indices: &[u32]) -> Result<(bool)> {
        let swapchains = &[self.inner];
        let present_info = vk::PresentInfoKHR::default()
            .wait_semaphores(wait_semaphores)
            .swapchains(swapchains)
            .image_indices(indices);
        match unsafe { self.loader.queue_present(*self.queue, &present_info) } {
            Ok(needs_rebuild) => Ok(needs_rebuild),
            // Err(err) if err == vk::Result::ERROR_OUT_OF_DATE_KHR => {
            Err(err) => Err(err.into()),
        }
    }
}

impl std::fmt::Debug for Swapchain {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.debug_struct("Swapchain")
            .field("inner", &format_args!("{:x}", self.inner.as_raw()))
            .finish()
    }
}
