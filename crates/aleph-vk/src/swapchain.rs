use {
    crate::{image::Image, Device, Instance, Queue, TIMEOUT_NS},
    anyhow::{anyhow, bail, Result},
    ash::{
        khr::{self, surface, swapchain},
        vk::{
            self, ColorSpaceKHR, CompositeAlphaFlagsKHR, Extent2D, Fence, Format, Handle,
            Image as VkImage, ImageAspectFlags, ImageUsageFlags, PresentInfoKHR, PresentModeKHR,
            Result as VkResult, Semaphore, SharingMode, SurfaceCapabilitiesKHR, SurfaceFormatKHR,
            SurfaceKHR, SurfaceTransformFlagsKHR, SwapchainCreateInfoKHR, SwapchainKHR,
        },
    },
    derive_more::Debug,
    raw_window_handle::{HasDisplayHandle, HasWindowHandle},
    std::sync::{Arc, Mutex},
    winit::window::Window,
};

pub const N_SWAPCHAIN_IMAGES: u32 = 3;

#[derive(Clone, Copy, Debug)]
pub struct SwapchainInfo {
    pub extent: Extent2D,
    pub format: Format,
    pub color_space: ColorSpaceKHR,
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
            extent: Extent2D {
                width: 1,
                height: 1,
            },
            format: Format::B8G8R8A8_SRGB,
            color_space: ColorSpaceKHR::SRGB_NONLINEAR,
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

    pub fn extent(&self) -> Extent2D { self.info.extent }

    pub fn format(&self) -> Format { self.info.format }

    pub fn images(&self) -> Vec<Image> {
        self.inner
            .lock()
            .unwrap_or_else(|e| panic!("Error locking swapchain: {:?}", e))
            .images
            .clone()
    }

    pub fn n_images(&self) -> usize { N_SWAPCHAIN_IMAGES as usize }

    pub fn rebuild(&self, extent: Extent2D) {
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

    pub fn acquire_next_image(&self, semaphore: Semaphore) -> Result<(usize, bool)> {
        self.inner
            .lock()
            .unwrap_or_else(|e| panic!("Error locking {:?}: {:?}", self.inner, e))
            .acquire_next_image(semaphore)
    }

    pub fn present(
        &self,
        queue: &Queue,
        wait_semaphores: &[Semaphore],
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
    handle: SwapchainKHR,
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
        old_swapchain: Option<SwapchainKHR>,
    ) -> Result<Self> {
        let queue = device.graphics_queue();
        let indices = [queue.family.index];
        let in_flight_frames = N_SWAPCHAIN_IMAGES;
        let capabilities: SurfaceCapabilitiesKHR = unsafe {
            surface
                .loader
                .get_physical_device_surface_capabilities(device.physical_device, surface.inner)
        }?;
        let mut swapchain_info = SwapchainCreateInfoKHR::default()
            .surface(surface.inner)
            .min_image_count(in_flight_frames)
            .image_format(info.format)
            .image_color_space(info.color_space)
            .image_extent(capabilities.current_extent)
            .image_sharing_mode(SharingMode::EXCLUSIVE)
            .image_array_layers(1)
            .present_mode(PresentModeKHR::FIFO)
            .pre_transform(SurfaceTransformFlagsKHR::IDENTITY)
            .composite_alpha(CompositeAlphaFlagsKHR::OPAQUE)
            .image_usage(ImageUsageFlags::COLOR_ATTACHMENT | ImageUsageFlags::TRANSFER_DST)
            .queue_family_indices(&indices);
        if let Some(old_swapchain) = old_swapchain {
            swapchain_info = swapchain_info.old_swapchain(old_swapchain);
        }
        let loader = khr::swapchain::Device::new(&instance.handle, &device.handle);
        let swapchain = unsafe { loader.create_swapchain(&swapchain_info, None) }.unwrap();

        let swapchain_images = unsafe { loader.get_swapchain_images(swapchain)? };
        let images = swapchain_images
            .iter()
            .enumerate()
            .map(|(i, swapchain_image)| {
                Image::new(
                    *swapchain_image,
                    device.clone(),
                    info.extent,
                    info.format,
                    ImageUsageFlags::TRANSFER_DST,
                    ImageAspectFlags::COLOR,
                    &format!("swapchain{i:02}"),
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
            handle: SwapchainKHR::null(),
            loader: khr::swapchain::Device::new(&instance.handle, &device.handle),
            device: device.clone(),
            images: vec![],
            info: SwapchainInfo {
                extent: Extent2D {
                    width: 1,
                    height: 1,
                },
                format: Format::B8G8R8A8_SRGB,
                color_space: ColorSpaceKHR::SRGB_NONLINEAR,
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

    pub fn acquire_next_image(&self, semaphore: Semaphore) -> Result<(usize, bool)> {
        match unsafe {
            self.loader.acquire_next_image(self.handle, TIMEOUT_NS, semaphore, Fence::null())
        } {
            Ok((index, needs_rebuild)) => Ok((index as usize, needs_rebuild)),
            Err(err) if err == VkResult::ERROR_OUT_OF_DATE_KHR => Ok((0, true)),
            Err(err) if err == VkResult::SUBOPTIMAL_KHR => Ok((0, true)),
            Err(err) => Err(err.into()),
        }
    }

    pub fn present(
        &self,
        queue: &Queue,
        wait_semaphores: &[Semaphore],
        image_indices: &[u32],
    ) -> Result<bool> {
        let swapchains = &[self.handle];
        let present_info = PresentInfoKHR::default()
            .wait_semaphores(wait_semaphores)
            .swapchains(swapchains)
            .image_indices(image_indices);

        match unsafe { self.loader.queue_present(queue.handle, &present_info) } {
            Ok(needs_rebuild) => Ok(needs_rebuild),
            Err(err) if err == VkResult::ERROR_OUT_OF_DATE_KHR => Ok(true),
            Err(err) if err == VkResult::SUBOPTIMAL_KHR => Ok(true),
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
    pub(crate) inner: SurfaceKHR,

    #[debug("{:#x}", loader.instance().as_raw())]
    pub(crate) loader: khr::surface::Instance,
}

impl Surface {
    pub fn headless(instance: &Instance) -> Self {
        Self {
            inner: SurfaceKHR::null(),
            loader: khr::surface::Instance::new(&instance.entry, &instance.handle),
        }
    }

    pub fn new(instance: &Instance, window: &winit::window::Window) -> Result<Self> {
        let inner: SurfaceKHR = unsafe {
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
