use {
    crate::{CommandBuffer, CommandPool, Device, Instance, Queue, Surface, VK_TIMEOUT_NS},
    anyhow::Result,
    ash::{
        khr,
        vk::{self, Handle},
    },
    derive_more::Debug,
};

pub const IN_FLIGHT_FRAMES: u32 = 2;

#[derive(Debug)]
pub struct Frame {
    pub swapchain_semaphore: vk::Semaphore,
    pub render_semaphore: vk::Semaphore,
    pub fence: vk::Fence,
    pub command_pool: CommandPool,
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
    #[debug("{:x}", handle.as_raw())]
    pub(crate) handle: vk::SwapchainKHR,
    #[debug("{:x}", loader.device().as_raw())]
    pub(crate) loader: khr::swapchain::Device,
    device: Device,
    surface: Surface,
    queue: Queue,
    instance: Instance,
    pub info: SwapchainInfo,
    image_views: Vec<vk::ImageView>,
    images: Vec<vk::Image>,
    current_index: u32,
}

impl Swapchain {
    pub fn new(
        instance: &Instance,
        device: &Device,
        surface: &Surface,
        info: &SwapchainInfo,
    ) -> Result<Self> {
        Self::create_swapchain(instance, device, surface, info, None)
    }

    pub fn rebuild(&mut self, extent: vk::Extent2D) -> Result<()> {
        let instance = self.instance.clone();
        let device = self.device.clone();
        let surface = self.surface.clone();
        let mut info = self.info;
        info.extent = extent;
        let new_swapchain =
            Self::create_swapchain(&instance, &device, &surface, &info, Some(self.handle))?;

        let old = std::mem::replace(self, new_swapchain);
        old.destroy();

        Ok(())
    }

    fn create_swapchain(
        instance: &Instance,
        device: &Device,
        surface: &Surface,
        info: &SwapchainInfo,
        old_swapchain: Option<vk::SwapchainKHR>,
    ) -> Result<Self> {
        let queue = device.queue;
        let indices = [queue.family.index];
        let in_flight_frames = IN_FLIGHT_FRAMES;
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
            .min_image_count(in_flight_frames)
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
            swapchain_info = swapchain_info.old_swapchain(old_swapchain);
        }
        let loader = khr::swapchain::Device::new(&instance.handle, device);
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
            handle: swapchain,
            loader,
            instance: instance.clone(),
            device: device.clone(),
            surface: surface.clone(),
            info: *info,
            image_views,
            images,
            queue: device.queue,
            current_index: 0,
        })
    }

    pub fn in_flight_frames(&self) -> u32 {
        self.image_views.len() as u32
    }

    pub fn current_index(&self) -> u32 {
        self.current_index
    }

    pub fn current_image(&self) -> vk::Image {
        self.images[self.current_index as usize]
    }

    pub fn current_image_view(&self) -> vk::ImageView {
        self.image_views[self.current_index as usize]
    }
}

impl Swapchain {
    pub fn destroy(&self) {
        log::info!("Destroying swapchain: {:?}", self);
        unsafe {
            self.loader.destroy_swapchain(self.handle, None);
            self.image_views
                .iter()
                .for_each(|v| self.device.destroy_image_view(*v, None));
        };
    }

    pub fn next_image(&mut self, semaphore: vk::Semaphore) -> Result<(u32, bool)> {
        match unsafe {
            self.loader
                .acquire_next_image(self.handle, VK_TIMEOUT_NS, semaphore, vk::Fence::null())
        } {
            Ok((index, needs_rebuild)) => {
                self.current_index = index;
                Ok((index, needs_rebuild))
            }
            Err(err) if err == vk::Result::ERROR_OUT_OF_DATE_KHR => {
                self.current_index = 0;
                Ok((0, true))
            }
            Err(err) if err == vk::Result::SUBOPTIMAL_KHR => {
                self.current_index = 0;
                Ok((0, true))
            }
            Err(err) => Err(err.into()),
        }
    }

    pub fn present(&mut self, wait_semaphores: &[vk::Semaphore], indices: &[u32]) -> Result<bool> {
        let swapchains = &[self.handle];
        let present_info = vk::PresentInfoKHR::default()
            .wait_semaphores(wait_semaphores)
            .swapchains(swapchains)
            .image_indices(indices);

        match unsafe { self.loader.queue_present(self.queue.handle, &present_info) } {
            Ok(needs_rebuild) => Ok(needs_rebuild),
            Err(err) if err == vk::Result::ERROR_OUT_OF_DATE_KHR => Ok(true),
            Err(err) if err == vk::Result::SUBOPTIMAL_KHR => Ok(true),
            Err(err) => Err(err.into()),
        }
    }
}