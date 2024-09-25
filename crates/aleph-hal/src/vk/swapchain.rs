use {
    super::{
        device::Texture,
        renderpass::{self, RenderPass},
    },
    crate::vk::{Device, Surface},
    anyhow::Result,
    ash::{
        khr,
        vk::{self, FrameBoundaryEXT},
    },
    std::{mem::swap, ops::Index, sync::Arc},
    vk::Handle,
};

pub struct Framebuffers {
    pub inner: Vec<vk::Framebuffer>,
    pub present_images: Vec<vk::Image>,
    pub depth_image: Texture,
}

impl Index<usize> for Framebuffers {
    type Output = vk::Framebuffer;
    fn index<'a>(&'a self, i: usize) -> &'a vk::Framebuffer {
        &self.inner[i]
    }
}

impl Device {
    pub fn create_framebuffers(
        &self,
        swapchain: &Swapchain,
        renderpass: &RenderPass,
    ) -> Result<Framebuffers> {
        let present_images = unsafe { swapchain.fns.get_swapchain_images(swapchain.inner)? };
        let present_image_views = &swapchain.image_views;
        let depth_image_create_info = vk::ImageCreateInfo::default()
            .image_type(vk::ImageType::TYPE_2D)
            .format(vk::Format::D16_UNORM)
            .extent(swapchain.properties.dims.into())
            .mip_levels(1)
            .array_layers(1)
            .samples(vk::SampleCountFlags::TYPE_1)
            .tiling(vk::ImageTiling::OPTIMAL)
            .usage(vk::ImageUsageFlags::DEPTH_STENCIL_ATTACHMENT)
            .sharing_mode(vk::SharingMode::EXCLUSIVE);

        let depth_image = self.create_texture(&depth_image_create_info);

        let framebuffers = present_image_views
            .iter()
            .map(|&present_image_view| {
                let framebuffer_attachments = [present_image_view, depth_image.view];
                let frame_buffer_create_info = vk::FramebufferCreateInfo::default()
                    .render_pass(renderpass.inner)
                    .attachments(&framebuffer_attachments)
                    .width(swapchain.properties.dims.width)
                    .height(swapchain.properties.dims.height)
                    .layers(1);

                unsafe {
                    self.inner
                        .create_framebuffer(&frame_buffer_create_info, None)
                        .unwrap()
                }
            })
            .collect();
        let fb = Framebuffers {
            inner: framebuffers,
            present_images,
            depth_image,
        };

        Ok(fb)
    }
}

pub struct SwapchainProperties {
    pub format: vk::SurfaceFormatKHR,
    pub dims: vk::Extent2D,
    pub vsync: bool,
}

pub struct Swapchain {
    pub inner: vk::SwapchainKHR,
    pub fns: khr::swapchain::Device,
    pub device: Arc<Device>,
    pub surface: Arc<Surface>,
    pub properties: SwapchainProperties,
    pub image_views: Vec<vk::ImageView>,
    pub acquire_semaphores: Vec<vk::Semaphore>,
    pub rendering_finished_semaphores: Vec<vk::Semaphore>,
    pub next_semaphore: usize,
}

impl Swapchain {
    pub fn enumerate_surface_formats(
        device: &Arc<Device>,
        surface: &Surface,
    ) -> Result<Vec<vk::SurfaceFormatKHR>> {
        unsafe {
            Ok(surface
                .fns
                .get_physical_device_surface_formats(device.physical_device.inner, surface.inner)?)
        }
    }
    pub fn new(
        device: &Arc<Device>,
        surface: &Arc<Surface>,
        properties: SwapchainProperties,
    ) -> Result<Arc<Swapchain>> {
        let surface_capabilities = unsafe {
            surface.fns.get_physical_device_surface_capabilities(
                device.physical_device.inner,
                surface.inner,
            )
        }?;

        let mut desired_image_count = 3.max(surface_capabilities.min_image_count);

        if surface_capabilities.max_image_count != 0 {
            desired_image_count = desired_image_count.min(surface_capabilities.max_image_count);
        }
        let surface_resolution = match surface_capabilities.current_extent.width {
            std::u32::MAX => properties.dims,
            _ => surface_capabilities.current_extent,
        };

        if 0 == surface_resolution.width || 0 == surface_resolution.height {
            anyhow::bail!("Swapchain resolution cannot be zero");
        }

        let present_mode_preference = if properties.vsync {
            vec![vk::PresentModeKHR::FIFO_RELAXED, vk::PresentModeKHR::FIFO]
        } else {
            vec![vk::PresentModeKHR::MAILBOX, vk::PresentModeKHR::IMMEDIATE]
        };

        let present_modes = unsafe {
            surface.fns.get_physical_device_surface_present_modes(
                device.physical_device.inner,
                surface.inner,
            )
        }?;

        let present_mode = present_mode_preference
            .into_iter()
            .find(|mode| present_modes.contains(mode))
            .unwrap_or(vk::PresentModeKHR::FIFO);

        let pre_transform = if surface_capabilities
            .supported_transforms
            .contains(vk::SurfaceTransformFlagsKHR::IDENTITY)
        {
            vk::SurfaceTransformFlagsKHR::IDENTITY
        } else {
            surface_capabilities.current_transform
        };
        let indices = &[device.queue.family.index];

        let swapchain_create_info = vk::SwapchainCreateInfoKHR::default()
            .surface(surface.inner)
            .min_image_count(desired_image_count)
            .image_color_space(properties.format.color_space)
            .image_format(properties.format.format)
            .image_extent(surface_resolution)
            .image_sharing_mode(vk::SharingMode::EXCLUSIVE)
            .pre_transform(pre_transform)
            .composite_alpha(vk::CompositeAlphaFlagsKHR::OPAQUE)
            .present_mode(present_mode)
            .clipped(true)
            .image_usage(vk::ImageUsageFlags::COLOR_ATTACHMENT)
            .queue_family_indices(indices)
            .image_array_layers(1);

        let fns = khr::swapchain::Device::new(&device.instance.inner, &device.inner);
        let swapchain = unsafe { fns.create_swapchain(&swapchain_create_info, None) }.unwrap();

        let images = unsafe { fns.get_swapchain_images(swapchain)? };
        let subresource_range = vk::ImageSubresourceRange::default()
            .aspect_mask(vk::ImageAspectFlags::COLOR)
            .base_mip_level(0)
            .level_count(1)
            .base_array_layer(0)
            .layer_count(1);
        let image_views: Vec<vk::ImageView> = images
            .iter()
            .map(|image| {
                let info = vk::ImageViewCreateInfo::default()
                    .image(*image)
                    .view_type(vk::ImageViewType::TYPE_2D)
                    .format(vk::Format::B8G8R8A8_UNORM)
                    .subresource_range(subresource_range);
                unsafe {
                    device
                        .inner
                        .create_image_view(&info, None)
                        .expect("Failed to create imageview")
                }
            })
            .collect();

        let acquire_semaphores = (0..images.len())
            .map(|_| {
                unsafe {
                    device
                        .inner
                        .create_semaphore(&vk::SemaphoreCreateInfo::default(), None)
                }
                .unwrap()
            })
            .collect();

        let rendering_finished_semaphores = (0..images.len())
            .map(|_| {
                unsafe {
                    device
                        .inner
                        .create_semaphore(&vk::SemaphoreCreateInfo::default(), None)
                }
                .unwrap()
            })
            .collect();
        Ok(Arc::new(Self {
            inner: swapchain,
            fns: fns,
            properties,
            device: device.clone(),
            surface: surface.clone(),
            rendering_finished_semaphores,
            image_views,
            acquire_semaphores,
            next_semaphore: 0,
        }))
    }
}

impl std::fmt::Debug for Swapchain {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Swapchain")
            .field("inner", &format_args!("{:x}", self.inner.as_raw()))
            .finish()
    }
}
