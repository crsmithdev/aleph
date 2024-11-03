use {
    crate::vk::{
        allocator::Allocator,
        device::Device,
        instance::{Instance, InstanceInfo},
        physical_device::PhysicalDevice,
        surface::{Surface, SurfaceInfo},
        swapchain::{Swapchain, SwapchainInfo},
    },
    anyhow::Result,
    ash::vk,
    core::fmt,
    std::sync::Arc,
    winit::window::Window,
};
pub struct RenderBackend {
    pub instance: Arc<Instance>,
    pub physical_device: Arc<PhysicalDevice>,
    pub surface: Arc<Surface>,
    pub swapchain: Arc<Swapchain>,
    pub device: Arc<Device>,
    pub allocator: Arc<Allocator>,
}

impl RenderBackend {
    pub fn new(window: &Arc<Window>) -> Result<Self> {
        Self::init_vulkan(window)
    }

    fn init_vulkan(window: &Arc<Window>) -> Result<RenderBackend> {
        log::info!("Initializing Vulkan, window: {window:?}");

        let instance = Arc::new(Instance::new(&InstanceInfo {
            window,
            debug: true,
        })?);
        log::info!("Created instance: {instance:?}");

        let surface = Arc::new(Surface::new(&SurfaceInfo {
            window,
            instance: &instance,
        })?);
        log::info!("Created surface: {surface:?}");

        let physical_device = instance.physical_devices()?.select_default()?;
        let device = Device::new(&instance, &physical_device)?;
        log::info!("Created device: {device:?}");

        let allocator = Arc::new(Allocator::new(&instance, &physical_device, &device)?);
        log::info!("Created allocator: {allocator:?}");

        let extent = vk::Extent2D {
            width: window.inner_size().width,
            height: window.inner_size().height,
        };
        let swapchain = Arc::new(Swapchain::new(&SwapchainInfo {
            instance: &instance,
            allocator: &allocator,
            physical_device: &physical_device,
            device: &device,
            surface: &surface,
            format: vk::Format::B8G8R8A8_UNORM,
            color_space: vk::ColorSpaceKHR::SRGB_NONLINEAR,
            vsync: true,
            extent,
        })?);
        log::info!("Created swapchain: {swapchain:?}");

        Ok(RenderBackend {
            instance,
            physical_device,
            surface,
            device: device,
            swapchain,
            allocator,
        })
    }

    pub fn resize(&mut self, width: u32, height: u32) -> Result<()> {
        log::info!("Resizing swapchain to {width}x{height}");
        self.swapchain.destroy();

        let extent = vk::Extent2D { width, height };
        let result = Swapchain::new(&SwapchainInfo {
            allocator: &self.allocator,
            instance: &self.instance,
            physical_device: &self.physical_device,
            device: &self.device,
            surface: &self.surface,
            format: vk::Format::B8G8R8A8_UNORM,
            color_space: vk::ColorSpaceKHR::SRGB_NONLINEAR,
            vsync: true,
            extent,
        });

        match result {
            Ok(swapchain) => {
                self.swapchain = Arc::new(swapchain);
                Ok(())
            }
            Err(err) => Err(anyhow::anyhow!(err)),
        }
    }

    pub fn transition_image(
        &self,
        buffer: vk::CommandBuffer,
        image: vk::Image,
        current_layout: vk::ImageLayout,
        new_layout: vk::ImageLayout,
    ) {
        let aspect_mask = match new_layout {
            vk::ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL => vk::ImageAspectFlags::DEPTH,
            _ => vk::ImageAspectFlags::COLOR,
        };
        let range = vk::ImageSubresourceRange::default()
            .aspect_mask(aspect_mask)
            .base_array_layer(0)
            .base_mip_level(0)
            .level_count(1)
            .layer_count(1);
        let barriers = &[vk::ImageMemoryBarrier2::default()
            .image(image)
            .src_stage_mask(vk::PipelineStageFlags2::ALL_COMMANDS)
            .src_access_mask(vk::AccessFlags2::MEMORY_WRITE)
            .dst_stage_mask(vk::PipelineStageFlags2::ALL_COMMANDS)
            .dst_access_mask(vk::AccessFlags2::MEMORY_WRITE | vk::AccessFlags2::MEMORY_READ)
            .old_layout(current_layout)
            .new_layout(new_layout)
            .subresource_range(range)];
        let dependency_info = vk::DependencyInfo::default().image_memory_barriers(barriers);

        unsafe {
            self.device
                .inner
                .cmd_pipeline_barrier2(buffer, &dependency_info);
        }
    }

    pub fn copy_image_to_image(
        &self,
        cmd: vk::CommandBuffer,
        src: vk::Image,
        dst: vk::Image,
        src_extent: vk::Extent3D,
        dst_extent: vk::Extent3D,
    ) {
        let src_subresource = vk::ImageSubresourceLayers::default()
            .aspect_mask(vk::ImageAspectFlags::COLOR)
            .layer_count(1);
        let dst_subresource = vk::ImageSubresourceLayers::default()
            .aspect_mask(vk::ImageAspectFlags::COLOR)
            .layer_count(1);
        let blit_region = vk::ImageBlit2::default()
            .src_subresource(src_subresource)
            .dst_subresource(dst_subresource)
            .src_offsets([
                vk::Offset3D::default(),
                vk::Offset3D::default()
                    .x(src_extent.width as i32)
                    .y(src_extent.height as i32)
                    .z(1),
            ])
            .dst_offsets([
                vk::Offset3D::default(),
                vk::Offset3D::default()
                    .x(dst_extent.width as i32)
                    .y(dst_extent.height as i32)
                    .z(1),
            ]);
        let regions = &[blit_region];
        let blit_info = vk::BlitImageInfo2::default()
            .src_image(src)
            .src_image_layout(vk::ImageLayout::TRANSFER_SRC_OPTIMAL)
            .dst_image(dst)
            .dst_image_layout(vk::ImageLayout::TRANSFER_DST_OPTIMAL)
            .regions(regions);

        unsafe { self.device.inner.cmd_blit_image2(cmd, &blit_info) }
    }

    pub fn create_command_buffer(&self, pool: vk::CommandPool) -> Result<vk::CommandBuffer> {
        let info = vk::CommandBufferAllocateInfo::default()
            .command_buffer_count(1)
            .command_pool(pool)
            .level(vk::CommandBufferLevel::PRIMARY);

        unsafe {
            self.device
                .inner
                .allocate_command_buffers(&info)
                .map(|b| b[0])
                .map_err(anyhow::Error::from)
        }
    }

    pub fn create_command_pool(&self) -> vk::CommandPool {
        let pool_create_info = vk::CommandPoolCreateInfo::default()
            .flags(vk::CommandPoolCreateFlags::RESET_COMMAND_BUFFER)
            .queue_family_index(self.device.queue.family.index);

        unsafe {
            self.device
                .inner
                .create_command_pool(&pool_create_info, None)
                .unwrap()
        }
    }
}

impl fmt::Debug for RenderBackend {
    fn fmt(&self, f: &mut fmt::Formatter) -> std::fmt::Result {
        f.debug_struct("RenderBackend")
            .field("instance", &self.instance)
            .field("physical_device", &self.physical_device)
            .field("surface", &self.surface)
            .field("swapchain", &self.swapchain)
            .field("device", &self.device)
            .finish()
    }
}
