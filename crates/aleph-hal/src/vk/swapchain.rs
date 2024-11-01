use {
    super::{allocator::Allocator, image::ImageInfo},
    crate::vk::{
        device::Device,
        image::Image,
        instance::Instance,
        physical_device::PhysicalDevice,
        surface::Surface,
    },
    anyhow::Result,
    ash::{
        khr,
        vk::{
            SurfaceTransformFlagsKHR,
            {self},
        },
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
    pub instance: &'a Arc<Instance>,
    pub physical_device: &'a Arc<PhysicalDevice>,
    pub device: &'a Arc<Device>,
    pub allocator: &'a Arc<Allocator>,
    pub surface: &'a Arc<Surface>,
    pub extent: vk::Extent2D,
    pub format: vk::Format,
    pub color_space: vk::ColorSpaceKHR,
    pub vsync: bool,
}

pub struct Swapchain {
    pub instance: Arc<Instance>,
    pub physical_device: Arc<PhysicalDevice>,
    pub device: Arc<Device>,
    pub inner: vk::SwapchainKHR,
    pub allocator: Arc<Allocator>,
    pub loader: khr::swapchain::Device,
    pub surface: Arc<Surface>,
    pub image_views: Vec<vk::ImageView>,
    pub images: Vec<vk::Image>,
    pub draw_image: Image,
    pub format: vk::Format,
    pub extent: vk::Extent2D,
    pub vsync: bool,
    pub color_space: vk::ColorSpaceKHR,
}

impl Swapchain {
    pub(crate) fn new(info: &SwapchainInfo) -> Result<Swapchain> {
        let capabilities = unsafe {
            info.surface
                .loader
                .get_physical_device_surface_capabilities(
                    info.device.physical_device.inner,
                    info.surface.inner,
                )
        }?;
        let surface_resolution = match capabilities.current_extent.width {
            std::u32::MAX => info.extent,
            _ => capabilities.current_extent,
        };
        let present_mode = match info.vsync {
            true => vk::PresentModeKHR::FIFO_RELAXED,
            false => vk::PresentModeKHR::MAILBOX,
        };
        let indices = &[info.device.queue.family.index];

        let swapchain_create_info = vk::SwapchainCreateInfoKHR::default()
            .surface(info.surface.inner)
            .min_image_count(SWAPCHAIN_IMAGES)
            .image_color_space(info.color_space)
            .image_format(info.format)
            .image_extent(surface_resolution)
            .image_sharing_mode(vk::SharingMode::EXCLUSIVE)
            .pre_transform(SurfaceTransformFlagsKHR::IDENTITY)
            .composite_alpha(vk::CompositeAlphaFlagsKHR::OPAQUE)
            .present_mode(present_mode)
            .clipped(true)
            .image_usage(vk::ImageUsageFlags::COLOR_ATTACHMENT | vk::ImageUsageFlags::TRANSFER_DST)
            .queue_family_indices(indices)
            .image_array_layers(1);
        let loader = khr::swapchain::Device::new(&info.instance.inner, &info.device.inner);
        let swapchain = unsafe { loader.create_swapchain(&swapchain_create_info, None) }.unwrap();

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
                        .inner
                        .create_image_view(&image_view_info, None)
                        .expect("Failed to create imageview")
                }
            })
            .collect();

        let draw_image = Image::new(&ImageInfo {
            allocator: &info.allocator,
            width: surface_resolution.width as usize,
            height: surface_resolution.height as usize,
            format: vk::Format::R16G16B16A16_SFLOAT,
            usage: vk::ImageUsageFlags::COLOR_ATTACHMENT
                | vk::ImageUsageFlags::TRANSFER_DST
                | vk::ImageUsageFlags::TRANSFER_SRC
                | vk::ImageUsageFlags::STORAGE,
        })?;

        Ok(Swapchain {
            device: info.device.clone(),
            instance: info.instance.clone(),
            allocator: info.allocator.clone(),
            physical_device: info.physical_device.clone(),
            inner: swapchain,
            format: info.format,
            extent: surface_resolution,
            vsync: info.vsync,
            color_space: info.color_space,
            surface: info.surface.clone(),
            image_views,
            draw_image,
            images,
            loader,
        })
    }

    pub fn destroy(&self) {
        unsafe {
            self.loader.destroy_swapchain(self.inner, None);
            self.image_views
                .iter()
                .for_each(|v| self.device.inner.destroy_image_view(*v, None));
        };
    }

    pub fn recreate(&mut self) -> Result<()> {
        let info = SwapchainInfo {
            allocator: &self.allocator,
            device: &self.device,
            physical_device: &self.device.physical_device,
            instance: &self.instance,
            surface: &self.surface,
            extent: self.extent,
            format: self.format,
            color_space: self.color_space,
            vsync: self.vsync,
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
}

impl Drop for Swapchain {
    fn drop(&mut self) {
        self.destroy();
    }
}
// impl RenderBackend {
//     pub(crate) fn init_swapchain(
//         instance: &Arc<crate::vk::instance::Instance>,
//         device: &Arc<Device>,
//         surface: &Arc<Surface>,
//         desc: SwapchainDesc,
//     ) -> Result<Arc<Swapchain>> {
//         let surface_capabilities = unsafe {
//             surface.loader.get_physical_device_surface_capabilities(
//                 device.physical_device.inner,
//                 surface.inner,
//             )
//         }?;

//         let mut desired_image_count = 3.max(surface_capabilities.min_image_count);

//         if surface_capabilities.max_image_count != 0 {
//             desired_image_count = desired_image_count.min(surface_capabilities.max_image_count);
//         }
//         let surface_resolution = match surface_capabilities.current_extent.width {
//             std::u32::MAX => desc.extent,
//             _ => surface_capabilities.current_extent,
//         };
//         let x: Arc<()> = Arc::default();
//         let present_mode_preference = if desc.vsync {
//             vec![vk::PresentModeKHR::FIFO_RELAXED, vk::PresentModeKHR::FIFO]
//         } else {
//             vec![vk::PresentModeKHR::MAILBOX, vk::PresentModeKHR::IMMEDIATE]
//         };

//         let present_modes = unsafe {
//             surface.loader.get_physical_device_surface_present_modes(
//                 device.physical_device.inner,
//                 surface.inner,
//             )
//         }?;

//         let present_mode = present_mode_preference
//             .into_iter()
//             .find(|mode| present_modes.contains(mode))
//             .unwrap_or(vk::PresentModeKHR::FIFO);

//         let pre_transform = if surface_capabilities
//             .supported_transforms
//             .contains(vk::SurfaceTransformFlagsKHR::IDENTITY)
//         {
//             vk::SurfaceTransformFlagsKHR::IDENTITY
//         } else {
//             surface_capabilities.current_transform
//         };
//         let indices = &[device.queue.family.index];

//         let swapchain_create_info = vk::SwapchainCreateInfoKHR::default()
//             .surface(surface.inner)
//             .min_image_count(desired_image_count)
//             .image_color_space(desc.color_space)
//             .image_format(desc.format)
//             .image_extent(surface_resolution)
//             .image_sharing_mode(vk::SharingMode::EXCLUSIVE)
//             .pre_transform(surface_capabilities.supported_transforms)
//             .composite_alpha(vk::CompositeAlphaFlagsKHR::OPAQUE)
//             .present_mode(present_mode)
//             .clipped(true)
//             .image_usage(vk::ImageUsageFlags::COLOR_ATTACHMENT |
// vk::ImageUsageFlags::TRANSFER_DST)             .queue_family_indices(indices)
//             .image_array_layers(1);

//         let loader = khr::swapchain::Device::new(&instance.inner, &device.inner);
//         let swapchain = unsafe { loader.create_swapchain(&swapchain_create_info, None)
// }.unwrap();

//         let images = unsafe { loader.get_swapchain_images(swapchain)? };
//         let subresource_range = vk::ImageSubresourceRange::default()
//             .aspect_mask(vk::ImageAspectFlags::COLOR)
//             .level_count(1)
//             .layer_count(1);
//         let views: Vec<vk::ImageView> = images
//             .iter()
//             .map(|image| {
//                 let info = vk::ImageViewCreateInfo::default()
//                     .image(*image)
//                     .view_type(vk::ImageViewType::TYPE_2D)
//                     .format(vk::Format::B8G8R8A8_UNORM)
//                     .subresource_range(subresource_range);
//                 device
//                     .create_image_view(info)
//                     .expect("Failed to create imageview")
//             })
//             .collect();
//         let images = unsafe { loader.get_swapchain_images(swapchain) }?;

//         Ok(Arc::new(Swapchain {
//             inner: swapchain,
//             desc,
//             surface: surface.clone(),
//             views,
//             images,
//             loader,
//         }))
//     }
// }

impl std::fmt::Debug for Swapchain {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.debug_struct("Swapchain")
            .field("inner", &format_args!("{:x}", self.inner.as_raw()))
            .finish()
    }
}
