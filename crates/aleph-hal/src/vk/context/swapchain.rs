use {
    crate::vk::{CommandBuffer, Device, Instance, Surface},
    aleph_core::constants::VK_TIMEOUT_NS,
    anyhow::{bail, Result},
    ash::{
        khr::{self, swapchain},
        vk::{self, Handle},
    },
    derive_more::Debug,
    std::sync::{Arc, Mutex},
};

pub const IN_FLIGHT_FRAMES: u32 = 2;

#[derive(Clone, Debug)]
pub struct Frame {
    pub swapchain_semaphore: vk::Semaphore,
    pub render_semaphore: vk::Semaphore,
    pub fence: vk::Fence,
    pub command_pool: vk::CommandPool,
    pub command_buffer: CommandBuffer,
}
#[derive(Clone, Copy, Debug)]
pub struct SwapchainInfo {
    pub extent: vk::Extent2D,
    pub format: vk::Format,
    pub color_space: vk::ColorSpaceKHR,
    pub vsync: bool,
    pub num_images: u32,
}

#[derive(Clone, Debug)]
pub struct Swapchain {
    inner: vk::SwapchainKHR,
    #[debug("{:x}", inner.as_raw())]
    loader: khr::swapchain::Device,
    device: Device,
    surface: Surface,
    instance: Instance,
    pub(crate) info: SwapchainInfo,
    image_views: Vec<vk::ImageView>,
    images: Vec<vk::Image>,
    current_index: usize,
    is_retired: Arc<Mutex<bool>>,
}

impl Swapchain {
    // pub fn recreate(&mut self, extent: vk::Extent2D) -> Result<Swapchain> {
    //     let mut is_retired = self
    //         .is_retired
    //         .lock()
    //         .map_err(|_| anyhow::anyhow!("Could not lock swapchain for recreation"))?;

    //     if *is_retired {
    //         bail!("Swapchain has already been used in Swapchain recreation");
    //     }

    //     unsafe { self.device.inner.device_wait_idle() }?;
    //     *is_retired = true;
    //     let mut info = self.info.clone();
    //     info.extent = extent;
    //     let swapchain = Self::create(
    //         &self.instance,
    //         &self.device,
    //         &self.surface,
    //         &info,
    //         Some(self),
    //     )?;
    //     Ok(swapchain)
    // }

    pub fn new(
        instance: &Instance,
        device: &Device,
        surface: &Surface,
        info: &SwapchainInfo,
        old_swapchain: Option<&Swapchain>,
    ) -> Result<Self> {
        Self::create(instance, device, surface, info, old_swapchain)
    }

    fn create(
        instance: &Instance,
        device: &Device,
        surface: &Surface,
        info: &SwapchainInfo,
        old_swapchain: Option<&Swapchain>,
    ) -> std::result::Result<Swapchain, anyhow::Error> {
        let indices = [device.queue.family_index];
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

        let mut swapchain_info = vk::SwapchainCreateInfoKHR::default()
            .surface(**surface)
            .min_image_count(IN_FLIGHT_FRAMES)
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
        if let Some(old_swapchain) = old_swapchain {
            swapchain_info = swapchain_info.old_swapchain(old_swapchain.inner);
        }
        let loader = khr::swapchain::Device::new(instance, &device.inner);
        let swapchain = unsafe { loader.create_swapchain(&swapchain_info, None) }?;

        let images = unsafe { loader.get_swapchain_images(swapchain)? };
        let subresource_range = vk::ImageSubresourceRange::default()
            .aspect_mask(vk::ImageAspectFlags::COLOR)
            .level_count(1)
            .layer_count(1);
        let image_views = images
            .iter()
            .map(|image| {
                let image_view_info = vk::ImageViewCreateInfo::default()
                    .image(*image)
                    .view_type(vk::ImageViewType::TYPE_2D)
                    .format(vk::Format::B8G8R8A8_UNORM)
                    .subresource_range(subresource_range);
                unsafe { device.inner.create_image_view(&image_view_info, None) }
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Swapchain {
            inner: swapchain,
            loader,
            instance: instance.clone(),
            device: device.clone(),
            surface: surface.clone(),
            info: *info,
            image_views,
            images,
            current_index: 0,
            is_retired: Arc::new(Mutex::new(false)),
        })
    }

    pub fn format(&self) -> vk::Format {
        self.info.format
    }

    pub fn in_flight_frames(&self) -> usize {
        IN_FLIGHT_FRAMES as usize
    }

    pub fn extent(&self) -> vk::Extent2D {
        self.info.extent
    }

    pub fn images(&self) -> Vec<vk::Image> {
        unsafe { self.loader.get_swapchain_images(self.inner).unwrap() }
    }

    pub fn image_views(&self) -> &[vk::ImageView] {
        &self.image_views
    }

    pub fn current_index(&self) -> usize {
        self.current_index
    }

    pub fn current_image(&self) -> vk::Image {
        self.images[self.current_index]
    }

    pub fn current_image_view(&self) -> vk::ImageView {
        self.image_views[self.current_index]
    }
}

impl Swapchain {
    fn destroy(&self) {
        log::info!("Destroying sapchain: {:?}", self);

        self.image_views
            .iter()
            .for_each(|v| unsafe { self.device.inner.destroy_image_view(*v, None) });

        unsafe {
            self.loader.destroy_swapchain(self.inner, None);
        }
    }

    // pub fn rebuild(&mut self) -> Result<()> {
    //     log::debug!("Rebuilding swapchain");
    //     unsafe { self.device.inner.device_wait_idle() }?;

    //     let size = self.window.inner_size();
    //     let mut info = self.info;
    //     info.extent = vk::Extent2D {
    //         width: size.width,
    //         height: size.height,
    //     };
    //     let old_swapchain = std::mem::replace(&mut self.inner, vk::SwapchainKHR::null());
    //     match Self::create(
    //         &self.instance,
    //         &self.device,
    //         &self.surface,
    //         self.window.clone(),
    //         &info,
    //         Some(&old_swapchain),
    //     ) {
    //         Ok(swapchain) => {
    //             *self = swapchain;
    //             log::info!("Rebuilt swapchain: {:?}", self);
    //             Ok(())
    //         }
    //         Err(e) => Err(e),
    //     }
    // }

    pub fn next_image(&mut self, semaphore: vk::Semaphore) -> Result<(u32, bool)> {
        let is_retired = self
            .is_retired
            .lock()
            .map_err(|_| anyhow::anyhow!("Could not lock swapchain for recreation"))?;

        if *is_retired {
            bail!("Swapchain has been retired");
        }

        match unsafe {
            self.loader
                .acquire_next_image(self.inner, VK_TIMEOUT_NS, semaphore, vk::Fence::null())
        } {
            Ok((index, needs_rebuild)) => {
                self.current_index = index as usize;
                Ok((index, needs_rebuild))
            }
            Err(err) => Err(err.into()),
        }
    }

    pub fn present(&mut self, wait_semaphores: &[vk::Semaphore], indices: &[u32]) -> Result<bool> {
        let swapchains = &[self.inner];
        let present_info = vk::PresentInfoKHR::default()
            .wait_semaphores(wait_semaphores)
            .swapchains(swapchains)
            .image_indices(indices);
        match unsafe {
            self.loader
                .queue_present(self.device.queue.inner, &present_info)
        } {
            Ok(needs_rebuild) => Ok(needs_rebuild),
            Err(err) if err == vk::Result::ERROR_OUT_OF_DATE_KHR => Ok(true),
            Err(err) => Err(err.into()),
        }
    }
}
