use {
    crate::vk::{
        buffer::{Buffer, BufferDesc},
        device::Device,
        instance::Instance,
        physical_device::PhysicalDevice,
        surface::Surface,
        swapchain::{Swapchain, SwapchainInfo},
    },
    anyhow::Result,
    ash::vk,
    core::fmt,
    gpu_allocator::vulkan::{Allocator, AllocatorCreateDesc},
    gpu_allocator::{
        vulkan::{Allocation, AllocationCreateDesc, AllocationScheme},
        MemoryLocation,
    },
    std::ptr,
    std::sync::{Arc, Mutex},
    winit::window::Window,
};
pub struct RenderBackend {
    pub instance: Arc<Instance>,
    pub physical_device: Arc<PhysicalDevice>,
    pub surface: Arc<Surface>,
    pub swapchain: Arc<Swapchain>,
    pub device: Arc<Device>,
    pub allocator: Arc<Mutex<Allocator>>,
}

impl RenderBackend {
    pub fn new(window: &Arc<Window>) -> Result<Self> {
        Self::init_vulkan(window)
    }

    fn init_vulkan(window: &Arc<Window>) -> Result<RenderBackend> {
        log::info!("Initializing Vulkan, window: {window:?}");

        let instance = Instance::builder(window.clone()).build()?;
        log::info!("Created instance: {instance:?}");

        let surface = Self::create_surface(instance.clone(), window.clone())?;
        log::info!("Created surface: {surface:?}");

        let physical_devices = Self::create_physical_devices(&instance)?;
        let physical_device = physical_devices.select_default()?;
        let device = Self::create_device(&instance, &physical_device)?;
        log::info!("Created device: {device:?}");

        let extent = vk::Extent2D {
            width: window.inner_size().width,
            height: window.inner_size().height,
        };
        let swapchain = Arc::new(Swapchain::new(&SwapchainInfo {
            instance: &instance,
            physical_device: &physical_device,
            device: &device,
            surface: &surface,
            format: vk::Format::B8G8R8A8_UNORM,
            color_space: vk::ColorSpaceKHR::SRGB_NONLINEAR,
            vsync: true,
            extent,
        })?);
        log::info!("Created swapchain: {swapchain:?}");

        let allocator = Arc::new(Mutex::new(Allocator::new(&AllocatorCreateDesc {
            instance: instance.inner.clone(),
            device: device.inner.clone(),
            physical_device: physical_device.inner,
            buffer_device_address: false,
            debug_settings: Default::default(),
            allocation_sizes: Default::default(),
        })?));

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
        self.swapchain.destroy();
        let extent = vk::Extent2D { width, height };
        let result = Swapchain::new(&SwapchainInfo {
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

    pub fn create_buffer<T>(&self, desc: BufferDesc, initial_data: Option<&[T]>) -> Result<Buffer> {
        let mut flags: vk::BufferUsageFlags = desc.usage.into();
        if initial_data.is_some() {
            flags |= vk::BufferUsageFlags::TRANSFER_DST;
        }
        let initial_data = initial_data.unwrap();
        let size = initial_data.len() * size_of::<T>();
        let (buffer, allocation) = self
            .allocate(size, flags, MemoryLocation::CpuToGpu)
            .unwrap();

        self.write_buffer(&allocation, initial_data)?;
        Ok(Buffer {
            inner: buffer,
            allocation,
        })
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

    pub fn write_buffer<T: Sized>(&self, allocation: &Allocation, data: &[T]) -> Result<()> {
        let buffer_ptr = allocation.mapped_ptr().unwrap().cast().as_ptr();
        unsafe { ptr::copy_nonoverlapping(data.as_ptr(), buffer_ptr, data.len()) }

        Ok(())
    }

    fn allocate(
        &self,
        bytes: usize,
        flags: vk::BufferUsageFlags,
        location: MemoryLocation,
    ) -> Result<(vk::Buffer, Allocation)> {
        let mut allocator = self.allocator.lock().unwrap();
        let info = vk::BufferCreateInfo::default()
            .size(bytes as u64)
            .usage(flags);
        let buffer = unsafe { self.device.inner.create_buffer(&info, None) }?;
        let requirements = unsafe { self.device.inner.get_buffer_memory_requirements(buffer) };

        let allocation = allocator.allocate(&AllocationCreateDesc {
            name: "buffer",
            requirements,
            location,
            linear: true,
            allocation_scheme: AllocationScheme::GpuAllocatorManaged,
        })?;

        unsafe {
            self.device
                .inner
                .bind_buffer_memory(buffer, allocation.memory(), allocation.offset())
        }?;

        Ok((buffer, allocation))
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
// fn allocate(
//     allocator: &Arc<Mutex<Allocator>>,
//     device: &ash::Device,
//     bytes: usize,
//     flags: vk::BufferUsageFlags,
//     location: MemoryLocation,
// ) -> Result<(vk::Buffer, Allocation)> {
//     let mut allocator = allocator.lock().unwrap();
//     let info = vk::BufferCreateInfo::default()
//         .size(bytes as u64)
//         .usage(flags);
//     let buffer = unsafe { device.create_buffer(&info, None) }?;
//     let requirements = unsafe { device.get_buffer_memory_requirements(buffer) };

//     let allocation = allocator.allocate(&AllocationCreateDesc {
//         name: "Buffer",
//         requirements,
//         location,
//         linear: true,
//         allocation_scheme: AllocationScheme::GpuAllocatorManaged,
//     })?;

//     unsafe { device.bind_buffer_memory(buffer, allocation.memory(), allocation.offset()) }?;

//     Ok((buffer, allocation))
// }
