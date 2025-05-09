use {
    super::{
        texture::WrappedTexture, CommandBuffer, CommandPool, Device, Instance, Queue, Surface,
        VK_TIMEOUT_NS,
    },
    crate::Texture,
    anyhow::Result,
    ash::{
        khr,
        vk::{self, CompositeAlphaFlagsKHR, Handle, SurfaceTransformFlagsKHR},
    },
    derive_more::Debug,
    tracing::instrument,
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

#[derive(Debug)]
pub struct Swapchain {
    #[debug("{:x}", handle.as_raw())]
    pub(crate) handle: vk::SwapchainKHR,
    #[debug("{:x}", loader.device().as_raw())]
    pub(crate) loader: khr::swapchain::Device,
    #[debug("{:x}", device.handle().handle().as_raw())]
    device: Device,
    #[debug("{:x}", surface.inner.as_raw())]
    surface: Surface,
    #[debug("{:x}", queue.handle.as_raw())]
    queue: Queue,
    #[debug("{:x}", instance.handle().handle().as_raw())]
    instance: Instance,
    info: SwapchainInfo,
    images: Vec<WrappedTexture>,
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

    #[instrument(skip(self))]
    pub fn rebuild(&mut self, extent: vk::Extent2D) -> Result<()> {
        let instance = self.instance.clone();
        let device = self.device.clone();
        let surface = self.surface.clone();
        let mut info = self.info;
        info.extent = extent;
        let next_swapchain =
            Self::create_swapchain(&instance, &device, &surface, &info, Some(self.handle))?;

        let last_swapchain = std::mem::replace(self, next_swapchain);
        last_swapchain.destroy();

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
                .get_physical_device_surface_capabilities(device.physical_device, surface.inner)
        }?;
        // let formats: Vec<vk::SurfaceFormatKHR> = unsafe {
        //     surface
        //         .loader
        //         .get_physical_device_surface_formats(device.physical_device, surface.inner)
        // }?;
        let mut swapchain_info = vk::SwapchainCreateInfoKHR::default()
            .surface(surface.inner)
            .min_image_count(in_flight_frames)
            .image_format(info.format)
            .image_color_space(info.color_space)
            .image_extent(capabilities.current_extent)
            .image_sharing_mode(vk::SharingMode::EXCLUSIVE)
            .image_array_layers(1)
            .present_mode(vk::PresentModeKHR::FIFO)
            .pre_transform(SurfaceTransformFlagsKHR::IDENTITY)
            .composite_alpha(CompositeAlphaFlagsKHR::OPAQUE)
            // .clipped(true)
            .image_usage(vk::ImageUsageFlags::COLOR_ATTACHMENT | vk::ImageUsageFlags::TRANSFER_DST)
            .queue_family_indices(&indices);
        if let Some(old_swapchain) = old_swapchain {
            swapchain_info = swapchain_info.old_swapchain(old_swapchain);
        }
        let loader = khr::swapchain::Device::new(&instance.handle, &device.handle);
        let swapchain = unsafe { loader.create_swapchain(&swapchain_info, None) }.unwrap();

        let images = unsafe { loader.get_swapchain_images(swapchain)? };
        let subresource_range = vk::ImageSubresourceRange::default()
            .aspect_mask(vk::ImageAspectFlags::COLOR)
            .level_count(1)
            .layer_count(1);

        let images = images
            .into_iter()
            .map(|handle| {
                let image_view_info = vk::ImageViewCreateInfo::default()
                    .image(handle)
                    .view_type(vk::ImageViewType::TYPE_2D)
                    .format(vk::Format::B8G8R8A8_SRGB)
                    .subresource_range(subresource_range);
                let view = unsafe {
                    device
                        .handle
                        .create_image_view(&image_view_info, None)
                        .expect("Failed to create imageview")
                };
                WrappedTexture::new(handle, view, info.extent, info.format, "swapchain image")
                    .expect("Failed to create image")
            })
            .collect::<Vec<_>>();
        Ok(Swapchain {
            handle: swapchain,
            loader,
            instance: instance.clone(),
            device: device.clone(),
            surface: surface.clone(),
            info: *info,
            images,
            queue: device.queue,
        })
    }

    pub fn in_flight_frames(&self) -> u32 { self.images.len() as u32 }

    pub fn images(&self) -> &[WrappedTexture] { &self.images }

    pub fn extent(&self) -> vk::Extent2D { self.info.extent }
}

impl Swapchain {
    pub fn destroy(&self) {
        unsafe {
            self.loader.destroy_swapchain(self.handle, None);
            self.images
                .iter()
                .for_each(|v| self.device.handle.destroy_image_view(v.view(), None));
        };
    }

    pub fn acquire_next_image(&self, semaphore: vk::Semaphore) -> Result<(u32, bool)> {
        match unsafe {
            self.loader
                .acquire_next_image(self.handle, VK_TIMEOUT_NS, semaphore, vk::Fence::null())
        } {
            Ok((index, needs_rebuild)) => Ok((index, needs_rebuild)),
            Err(err) if err == vk::Result::ERROR_OUT_OF_DATE_KHR => Ok((0, true)),
            Err(err) if err == vk::Result::SUBOPTIMAL_KHR => Ok((0, true)),
            Err(err) => Err(err.into()),
        }
    }

    pub fn present(&self, wait_semaphores: &[vk::Semaphore], indices: &[u32]) -> Result<bool> {
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
