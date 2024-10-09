use {
    super::RenderBackend,
    crate::vk::{Device, Surface},
    anyhow::{Error, Result},
    ash::{
        khr,
        vk::{self},
    },
    std::{fmt, ops::Index, sync::Arc},
    vk::Handle,
};

const MAX_FRAMES: u32 = 2;

pub struct Frame {
    pub(crate) index: usize,
    pub(crate) swapchain_semaphore: vk::Semaphore,
    pub(crate) render_semaphore: vk::Semaphore,
    pub(crate) fence: vk::Fence,
    pub(crate) command_pool: vk::CommandPool,
    pub(crate) command_buffer: vk::CommandBuffer,
}

pub struct SwapchainDesc {
    pub format: vk::Format,
    pub extent: vk::Extent2D,
    pub vsync: bool,
    pub color_space: vk::ColorSpaceKHR,
}

pub struct Swapchain {
    pub inner: vk::SwapchainKHR,
    pub fns: khr::swapchain::Device,
    pub device: Arc<Device>,
    pub surface: Arc<Surface>,
    pub image_views: Vec<vk::ImageView>,
    pub desc: SwapchainDesc,
}

impl RenderBackend {
    pub(crate) fn create_swapchain(
        device: Arc<Device>,
        surface: Arc<Surface>,
        desc: SwapchainDesc,
    ) -> Result<Arc<Swapchain>> {
        let surface_capabilities = unsafe {
            surface.fns.get_physical_device_surface_capabilities(
                device.physical_device.inner,
                surface.inner,
            )
        }?;

        let mut desired_image_count = 2.max(surface_capabilities.min_image_count);

        if surface_capabilities.max_image_count != 0 {
            desired_image_count = desired_image_count.min(surface_capabilities.max_image_count);
        }
        let surface_resolution = match surface_capabilities.current_extent.width {
            std::u32::MAX => desc.extent,
            _ => surface_capabilities.current_extent,
        };

        let present_mode_preference = if desc.vsync {
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
            .image_color_space(desc.color_space)
            .image_format(desc.format)
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
                device
                    .create_image_view(info)
                    .expect("Failed to create imageview")
            })
            .collect();

        Ok(Arc::new(Swapchain {
            inner: swapchain,
            fns: fns,
            desc,
            device: device,
            surface: surface.clone(),
            image_views,
        }))
    }

    // pub fn create_frames(&self, swapchain: &Swapchain) -> Result<Vec<Frame>> {
    //     let pool_create_info = vk::CommandPoolCreateInfo::default()
    //         .flags(vk::CommandPoolCreateFlags::RESET_COMMAND_BUFFER)
    //         .queue_family_index(self.queue.family.index);

    //     (0..swapchain.image_views.len())
    //         .map(|index| {
    //             let command_pool = unsafe {
    //                 self.inner
    //                     .create_command_pool(&pool_create_info, None)
    //                     .unwrap()
    //             };
    //             let command_buffer_info = vk::CommandBufferAllocateInfo::default()
    //                 .command_buffer_count(1)
    //                 .command_pool(command_pool)
    //                 .level(vk::CommandBufferLevel::PRIMARY);

    //             let command_buffer =
    //                 unsafe { self.inner.allocate_command_buffers(&command_buffer_info) }?[0];
    //             let swapchain_semaphore = self.create_semaphore()?;
    //             let render_semaphore = self.create_semaphore()?;
    //             let fence = self.create_fence(true)?;

    //             Ok(Frame {
    //                 index,
    //                 swapchain_semaphore,
    //                 render_semaphore,
    //                 fence,
    //                 command_pool,
    //                 command_buffer,
    //             })
    //         })
    //         .collect::<Result<Vec<Frame>>>()
    // }
}

impl std::fmt::Debug for Swapchain {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.debug_struct("Swapchain")
            .field("inner", &format_args!("{:x}", self.inner.as_raw()))
            .finish()
    }
}

/*
pub struct Framebuffers {
    pub inner: Vec<vk::Framebuffer>,
    pub present_images: Vec<vk::Image>,
    pub depth_image: Texture,
}

impl fmt::Debug for Framebuffers {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.debug_struct("Framebuffers").finish_non_exhaustive()
    }
}

impl Index<usize> for Framebuffers {
    type Output = vk::Framebuffer;
    fn index(&'a self, i: usize) -> &'a vk::Framebuffer {
        &self.inner[i]
    }
}

impl Device {
    pub fn create_framebuffers(
        &self,
        swapchain: &Swapchain,
        render_pass: &RenderPass,
    ) -> Result<Framebuffers> {
        let present_images = unsafe { swapchain.fns.get_swapchain_images(swapchain.inner)? };
        let present_image_views = &swapchain.image_views;
        let depth_image_create_info = vk::ImageCreateInfo::default()
            .format(vk::Format::D16_UNORM)
            .extent(swapchain.desc.extent.into())
            .mip_levels(1)
            .array_layers(1)
            .samples(vk::SampleCountFlags::TYPE_1)
            .tiling(vk::ImageTiling::OPTIMAL)
            .usage(vk::ImageUsageFlags::DEPTH_STENCIL_ATTACHMENT)
            .sharing_mode(vk::SharingMode::EXCLUSIVE);

        let depth_image = self.create_texture(&depth_image_create_info)?;

        let framebuffers = present_image_views
            .iter()
            .map(|&present_image_view| {
                let framebuffer_attachments = [present_image_view, depth_image.view];
                let frame_buffer_create_info = vk::FramebufferCreateInfo::default()
                    .render_pass(render_pass.inner)
                    .attachments(&framebuffer_attachments)
                    .width(swapchain.desc.extent.width)
                    .height(swapchain.desc.extent.height)
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
*/
