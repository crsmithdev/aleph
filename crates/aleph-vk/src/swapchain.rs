use {
    crate::{texture::Image, CommandBuffer, CommandPool, Device, Instance, Queue, TIMEOUT_NS},
    anyhow::Result,
    ash::{
        khr,
        vk::{self, CompositeAlphaFlagsKHR, Handle, SurfaceTransformFlagsKHR},
    },
    derive_more::Debug,
    raw_window_handle::{HasDisplayHandle, HasWindowHandle},
    std::sync::Mutex,
};

pub const IN_FLIGHT_FRAMES: u32 = 3;

#[derive(Clone, Copy, Debug)]
pub struct SwapchainInfo {
    pub extent: vk::Extent2D,
    pub format: vk::Format,
    pub color_space: vk::ColorSpaceKHR,
    pub vsync: bool,
    pub num_images: usize,
}

#[derive(Debug)]
pub struct Swapchain {
    inner: Mutex<SwapchainInner>,
    instance: Instance,
    device: Device,
    surface: Surface,
    info: SwapchainInfo,
}

impl Swapchain {
    pub fn new(
        instance: &Instance,
        device: &Device,
        surface: &Surface,
        info: &SwapchainInfo,
    ) -> Result<Self> {
        let inner = Mutex::new(SwapchainInner::new(instance, device, surface, info, None)?);
        Ok(Self {
            inner,
            device: device.clone(),
            surface: surface.clone(),
            instance: instance.clone(),
            info: *info,
        })
    }

    pub fn headless(instance: &Instance, device: &Device) -> Result<Self> {
        let inner = Mutex::new(SwapchainInner::headless(instance, device)?);
        let info = SwapchainInfo {
            extent: vk::Extent2D {
                width: 1,
                height: 1,
            },
            format: vk::Format::B8G8R8A8_SRGB,
            color_space: vk::ColorSpaceKHR::SRGB_NONLINEAR,
            vsync: true,
            num_images: 1,
        };
        Ok(Self {
            inner,
            device: device.clone(),
            surface: Surface::headless(instance),
            instance: instance.clone(),
            info,
        })
    }

    pub fn extent(&self) -> vk::Extent2D { self.info.extent }

    pub fn format(&self) -> vk::Format { self.info.format }

    pub fn images(&self) -> Vec<Image> {
        self.inner
            .lock()
            .unwrap_or_else(|e| panic!("Error locking swapchain: {:?}", e))
            .images
            .clone()
    }

    pub fn n_images(&self) -> usize { IN_FLIGHT_FRAMES as usize }

    pub fn rebuild(&self, extent: vk::Extent2D) {
        log::debug!("Rebuilding swapchain with extent: {:?}", extent);
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|e| panic!("Error locking {:?}: {:?}", self.inner, e));
        let mut info = inner.info;
        info.extent = extent;

        *inner = SwapchainInner::new(
            &self.instance,
            &self.device,
            &self.surface,
            &info,
            Some(inner.handle),
        )
        .unwrap_or_else(|e| panic!("Error rebuilding swapchain: {e:?}"));
    }

    pub fn acquire_next_image(&self, semaphore: vk::Semaphore) -> Result<(usize, bool)> {
        self.inner
            .lock()
            .unwrap_or_else(|e| panic!("Error locking {:?}: {:?}", self.inner, e))
            .acquire_next_image(semaphore)
    }

    pub fn present(
        &self,
        queue: &Queue,
        wait_semaphores: &[vk::Semaphore],
        indices: &[u32],
    ) -> Result<bool> {
        self.inner
            .lock()
            .unwrap_or_else(|e| panic!("Error acquiring lock for {:?}: {:?}", self.inner, e))
            .present(queue, wait_semaphores, indices)
    }
}
#[derive(Debug)]
struct SwapchainInner {
    #[debug("{:#x}", handle.as_raw())]
    handle: vk::SwapchainKHR,
    #[debug("{:#x}", device.handle().handle().as_raw())]
    device: Device,
    #[debug("{:?}", images.iter().map(|v| format!("{:#x}", v.handle().as_raw())))]
    images: Vec<Image>,
    #[debug("{:#x}", loader.device().as_raw())]
    loader: khr::swapchain::Device,
    info: SwapchainInfo,
}

impl SwapchainInner {
    fn new(
        instance: &Instance,
        device: &Device,
        surface: &Surface,
        info: &SwapchainInfo,
        old_swapchain: Option<vk::SwapchainKHR>,
    ) -> Result<Self> {
        let queue = device.graphics_queue();
        let indices = [queue.family.index];
        let in_flight_frames = IN_FLIGHT_FRAMES;
        let capabilities: vk::SurfaceCapabilitiesKHR = unsafe {
            surface
                .loader
                .get_physical_device_surface_capabilities(device.physical_device, surface.inner)
        }?;
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
            .image_usage(vk::ImageUsageFlags::COLOR_ATTACHMENT | vk::ImageUsageFlags::TRANSFER_DST)
            .queue_family_indices(&indices);
        if let Some(old_swapchain) = old_swapchain {
            swapchain_info = swapchain_info.old_swapchain(old_swapchain);
        }
        let loader = khr::swapchain::Device::new(&instance.handle, &device.handle);
        let swapchain = unsafe { loader.create_swapchain(&swapchain_info, None) }.unwrap();

        let swapchain_images = unsafe { loader.get_swapchain_images(swapchain)? };
        let images = swapchain_images
            .iter()
            .map(|swapchain_image| {
                Image::new(
                    *swapchain_image,
                    device.clone(),
                    info.extent,
                    info.format,
                    vk::ImageAspectFlags::COLOR,
                )
            })
            .collect::<Result<Vec<_>>>()?;

        Ok(SwapchainInner {
            handle: swapchain,
            device: device.clone(),
            loader,
            images,
            info: *info,
        })
    }

    pub fn headless(instance: &Instance, device: &Device) -> Result<Self> {
        Ok(Self {
            handle: vk::SwapchainKHR::null(),
            loader: khr::swapchain::Device::new(&instance.handle, &device.handle),
            device: device.clone(),
            images: vec![],
            info: SwapchainInfo {
                extent: vk::Extent2D {
                    width: 1,
                    height: 1,
                },
                format: vk::Format::B8G8R8A8_SRGB,
                color_space: vk::ColorSpaceKHR::SRGB_NONLINEAR,
                vsync: true,
                num_images: 1,
            },
        })
    }

    pub fn destroy(&self) {
        unsafe {
            self.loader.destroy_swapchain(self.handle, None);
            self.images
                .iter()
                .for_each(|v| self.device.handle.destroy_image_view(v.view(), None));
        };
    }

    pub fn acquire_next_image(&self, semaphore: vk::Semaphore) -> Result<(usize, bool)> {
        match unsafe {
            self.loader
                .acquire_next_image(self.handle, TIMEOUT_NS, semaphore, vk::Fence::null())
        } {
            Ok((index, needs_rebuild)) => Ok((index as usize, needs_rebuild)),
            Err(err) if err == vk::Result::ERROR_OUT_OF_DATE_KHR => Ok((0, true)),
            Err(err) if err == vk::Result::SUBOPTIMAL_KHR => Ok((0, true)),
            Err(err) => Err(err.into()),
        }
    }

    pub fn present(
        &self,
        queue: &Queue,
        wait_semaphores: &[vk::Semaphore],
        image_indices: &[u32],
    ) -> Result<bool> {
        let swapchains = &[self.handle];
        let present_info = vk::PresentInfoKHR::default()
            .wait_semaphores(wait_semaphores)
            .swapchains(swapchains)
            .image_indices(image_indices);

        match unsafe { self.loader.queue_present(queue.handle, &present_info) } {
            Ok(needs_rebuild) => Ok(needs_rebuild),
            Err(err) if err == vk::Result::ERROR_OUT_OF_DATE_KHR => Ok(true),
            Err(err) if err == vk::Result::SUBOPTIMAL_KHR => Ok(true),
            Err(err) => Err(err.into()),
        }
    }
}

impl Drop for SwapchainInner {
    fn drop(&mut self) { self.destroy(); }
}

#[derive(Clone, Debug)]
pub struct Surface {
    #[debug("{:#x}", inner.as_raw())]
    pub(crate) inner: vk::SurfaceKHR,

    #[debug("{:#x}", loader.instance().as_raw())]
    pub(crate) loader: khr::surface::Instance,
}

impl Surface {
    pub fn headless(instance: &Instance) -> Self {
        Self {
            inner: vk::SurfaceKHR::null(),
            loader: khr::surface::Instance::new(&instance.entry, &instance.handle),
        }
    }

    pub fn new(instance: &Instance, window: &winit::window::Window) -> Result<Self> {
        let inner: vk::SurfaceKHR = unsafe {
            ash_window::create_surface(
                &instance.entry,
                &instance.handle,
                window.display_handle()?.into(),
                window.window_handle()?.into(),
                None,
            )?
        };

        let loader = khr::surface::Instance::new(&instance.entry, &instance.handle);
        Ok(Self { inner, loader })
    }
}

#[derive(Debug)]
pub struct Frame {
    #[debug("{:#x}", acquire_semaphore.as_raw())]
    pub acquire_semaphore: vk::Semaphore,
    #[debug("{:#x}", present_semaphore.as_raw())]
    pub present_semaphore: vk::Semaphore,
    #[debug("{:#x}", fence.as_raw())]
    pub fence: vk::Fence,
    #[debug("{:#x}", cmd_pool.handle().as_raw())]
    pub cmd_pool: CommandPool,
    #[debug("{:#x}", cmd_buffer.handle().as_raw())]
    pub cmd_buffer: CommandBuffer,
}
