pub mod allocator;
pub mod backend;
pub mod buffer;
pub mod debug;
pub mod descriptor;
pub mod image;
pub mod swapchain;

use {
    crate::vk::{
        allocator::Allocator,
        debug::vulkan_debug_callback,
        swapchain::{Swapchain, SwapchainInfo},
    },
    aleph_core::constants::VK_TIMEOUT_NS,
    anyhow::{anyhow, Result},
    ash::{
        ext,
        khr,
        vk::{self, Handle},
    },
    core::fmt,
    raw_window_handle::{HasDisplayHandle, HasWindowHandle},
    std::{ffi, sync::Arc},
    winit::window::Window,
};

const APP_NAME: &ffi::CStr = c"Aleph";
const INSTANCE_LAYERS: [&ffi::CStr; 1] = [
    // c"VK_LAYER_LUNARG_api_dump",
    c"VK_LAYER_KHRONOS_validation",
];
const INSTANCE_EXTENSIONS: [&ffi::CStr; 4] = [
    khr::surface::NAME,
    khr::win32_surface::NAME,
    khr::get_physical_device_properties2::NAME,
    ext::debug_utils::NAME,
];
const DEVICE_EXTENSIONS: [&ffi::CStr; 6] = [
    khr::swapchain::NAME,
    khr::synchronization2::NAME,
    khr::maintenance3::NAME,
    khr::dynamic_rendering::NAME,
    ext::descriptor_indexing::NAME,
    khr::buffer_device_address::NAME,
];

#[allow(dead_code)]
pub struct RenderBackend {
    pub instance: ash::Instance,
    pub physical_device: vk::PhysicalDevice,
    pub surface: vk::SurfaceKHR,
    pub surface_fns: khr::surface::Instance,
    pub swapchain: Swapchain,
    pub device: ash::Device,
    pub allocator: Arc<Allocator>,
    entry: ash::Entry,
    queue: vk::Queue,
    queue_family_index: u32,
    debug_utils: ext::debug_utils::Instance,
    debug_callback: vk::DebugUtilsMessengerEXT,
}

impl RenderBackend {
    pub fn new(window: &Arc<Window>) -> Result<Self> {
        Self::init_vulkan(window)
    }
}

impl RenderBackend /* Init */ {
    fn init_vulkan(window: &Arc<Window>) -> Result<RenderBackend> {
        log::info!("Initializing Vulkan, window: {window:?}");

        let entry = unsafe { ash::Entry::load()? };
        let instance = Self::init_instance(&entry)?;
        log::info!("Created instance: {:?}", instance.handle());

        let (debug_utils, debug_callback) = Self::init_debug(&entry, &instance)?;

        let (surface, surface_fns) = Self::init_surface(&entry, &instance, window)?;
        log::info!("Created surface: {surface:?}");

        let physical_device = Self::init_physical_device(&instance)?;
        log::info!("Selected physical device: {physical_device:?}");

        let (queue_family_index, queue_family) =
            Self::init_queue_families(&instance, &physical_device)?;
        log::info!("Selected queue family: {queue_family:?}, index: {queue_family_index}");

        let device = Self::init_device(&instance, &physical_device, queue_family_index)?;
        log::info!("Created device: {:?}", device.handle());

        let queue = Self::init_queue(&device, queue_family_index);
        log::info!("Created queue: {queue:?}");

        let allocator = Arc::new(Allocator::new(&instance, &physical_device, &device)?);
        log::info!("Created allocator: {allocator:?}");

        let extent = vk::Extent2D {
            width: window.inner_size().width,
            height: window.inner_size().height,
        };
        let swapchain = Swapchain::new(&SwapchainInfo {
            instance: &instance,
            allocator: &allocator,
            physical_device: &physical_device,
            device: &device,
            surface: &surface,
            surface_fns: &surface_fns,
            queue_family_index,
            queue: &queue,
            format: vk::Format::B8G8R8A8_UNORM,
            color_space: vk::ColorSpaceKHR::SRGB_NONLINEAR,
            vsync: true,
            extent,
        })?;
        log::info!("Created swapchain: {swapchain:?}");

        Ok(RenderBackend {
            entry,
            instance,
            physical_device,
            surface,
            surface_fns,
            device,
            allocator,
            swapchain,
            queue,
            queue_family_index,
            debug_utils,
            debug_callback,
        })
    }

    fn init_instance(entry: &ash::Entry) -> Result<ash::Instance> {
        let layers: Vec<*const i8> = INSTANCE_LAYERS.iter().map(|n| n.as_ptr()).collect();
        let extensions: Vec<*const i8> = INSTANCE_EXTENSIONS.iter().map(|n| n.as_ptr()).collect();

        let app_info = vk::ApplicationInfo::default()
            .application_name(APP_NAME)
            .application_version(0)
            .engine_name(APP_NAME)
            .engine_version(0)
            .api_version(vk::make_api_version(0, 1, 3, 0));
        let instance_info = vk::InstanceCreateInfo::default()
            .application_info(&app_info)
            .enabled_layer_names(&layers)
            .enabled_extension_names(&extensions)
            .flags(vk::InstanceCreateFlags::default());

        Ok(unsafe { entry.create_instance(&instance_info, None)? })
    }

    fn init_debug(
        entry: &ash::Entry,
        instance: &ash::Instance,
    ) -> Result<(ext::debug_utils::Instance, vk::DebugUtilsMessengerEXT)> {
        let debug_info = vk::DebugUtilsMessengerCreateInfoEXT::default()
            .message_severity(
                vk::DebugUtilsMessageSeverityFlagsEXT::ERROR
                    | vk::DebugUtilsMessageSeverityFlagsEXT::WARNING
                    | vk::DebugUtilsMessageSeverityFlagsEXT::INFO,
            )
            .message_type(
                vk::DebugUtilsMessageTypeFlagsEXT::GENERAL
                    | vk::DebugUtilsMessageTypeFlagsEXT::VALIDATION
                    | vk::DebugUtilsMessageTypeFlagsEXT::PERFORMANCE,
            )
            .pfn_user_callback(Some(vulkan_debug_callback));
        let debug_utils = ext::debug_utils::Instance::new(&entry, &instance);
        let debug_callback = unsafe {
            debug_utils
                .create_debug_utils_messenger(&debug_info, None)
                .unwrap()
        };

        Ok((debug_utils, debug_callback))
    }

    pub fn init_surface(
        entry: &ash::Entry,
        instance: &ash::Instance,
        window: &winit::window::Window,
    ) -> Result<(vk::SurfaceKHR, khr::surface::Instance)> {
        let surface: vk::SurfaceKHR = unsafe {
            ash_window::create_surface(
                &entry,
                &instance,
                window.display_handle()?.into(),
                window.window_handle()?.into(),
                None,
            )?
        };

        let loader = khr::surface::Instance::new(&entry, &instance);

        Ok((surface, loader))
    }

    fn rank_physical_device(instance: &ash::Instance, physical_device: &vk::PhysicalDevice) -> i32 {
        let device_properties =
            unsafe { instance.get_physical_device_properties(*physical_device) };
        let queue_families =
            unsafe { instance.get_physical_device_queue_family_properties(*physical_device) };

        // TODO extension checks

        let mut score = match queue_families
            .into_iter()
            .find(|qf| qf.queue_flags.contains(vk::QueueFlags::GRAPHICS))
        {
            Some(_) => 10000,
            None => 0,
        };

        score = score
            + match device_properties.device_type {
                vk::PhysicalDeviceType::INTEGRATED_GPU => 20,
                vk::PhysicalDeviceType::DISCRETE_GPU => 100,
                vk::PhysicalDeviceType::VIRTUAL_GPU => 1,
                _ => 0,
            };

        score
    }

    fn init_queue_families(
        instance: &ash::Instance,
        physical_device: &vk::PhysicalDevice,
    ) -> Result<(u32, vk::QueueFamilyProperties)> {
        let queue_families =
            unsafe { instance.get_physical_device_queue_family_properties(*physical_device) };
        let selected = queue_families
            .into_iter()
            .enumerate()
            .find(|(_, qf)| qf.queue_flags.contains(vk::QueueFlags::GRAPHICS));

        match selected {
            Some((index, qf)) => Ok((index as _, qf)),
            None => Err(anyhow!("No suitable queue family found")),
        }
    }

    fn init_queue(device: &ash::Device, queue_family_index: u32) -> vk::Queue {
        unsafe { device.get_device_queue(queue_family_index, 0) }
    }

    fn init_device(
        instance: &ash::Instance,
        physical_device: &vk::PhysicalDevice,
        queue_family_index: u32,
    ) -> Result<ash::Device> {
        let device_extension_names: Vec<*const i8> = DEVICE_EXTENSIONS
            .iter()
            .map(|n| n.as_ptr())
            .collect::<Vec<_>>();

        let priorities = [1.0];
        let queue_info = [vk::DeviceQueueCreateInfo::default()
            .queue_family_index(queue_family_index)
            .queue_priorities(&priorities)];

        let mut synchronization_features =
            ash::vk::PhysicalDeviceSynchronization2FeaturesKHR::default().synchronization2(true);
        let mut buffer_device_address_features =
            ash::vk::PhysicalDeviceBufferDeviceAddressFeaturesKHR::default()
                .buffer_device_address(true);
        let mut device_features = vk::PhysicalDeviceFeatures2::default()
            .push_next(&mut synchronization_features)
            .push_next(&mut buffer_device_address_features);

        let device_info = vk::DeviceCreateInfo::default()
            .queue_create_infos(&queue_info)
            .enabled_extension_names(&device_extension_names)
            .push_next(&mut device_features);

        Ok(unsafe { instance.create_device(*physical_device, &device_info, None)? })
    }

    fn init_physical_device(instance: &ash::Instance) -> Result<vk::PhysicalDevice> {
        let physical_devices = unsafe { instance.enumerate_physical_devices()? };

        let selected = physical_devices
            .into_iter()
            .rev()
            .max_by_key(|d| Self::rank_physical_device(instance, d));
        match selected {
            Some(device) => Ok(device),
            None => Err(anyhow!("No suitable physical device found")),
        }
    }
}

impl RenderBackend /* Synchronization */ {
    pub fn create_fence(&self) -> Result<vk::Fence> {
        Ok(unsafe {
            self.device
                .create_fence(&vk::FenceCreateInfo::default(), None)?
        })
    }

    pub fn create_fence_signaled(&self) -> Result<vk::Fence> {
        Ok(unsafe {
            self.device.create_fence(
                &vk::FenceCreateInfo::default().flags(vk::FenceCreateFlags::SIGNALED),
                None,
            )?
        })
    }

    pub fn wait_for_fence(&self, fence: vk::Fence) -> Result<()> {
        Ok(unsafe { self.device.wait_for_fences(&[fence], true, VK_TIMEOUT_NS)? })
    }

    pub fn reset_fence(&self, fence: vk::Fence) -> Result<()> {
        Ok(unsafe { self.device.reset_fences(&[fence])? })
    }

    pub fn create_semaphore(&self) -> Result<vk::Semaphore> {
        Ok(unsafe {
            self.device
                .create_semaphore(&vk::SemaphoreCreateInfo::default(), None)?
        })
    }
}

impl RenderBackend /* Commands */ {
    pub fn create_command_pool(&self) -> Result<vk::CommandPool> {
        let pool_create_info = vk::CommandPoolCreateInfo::default()
            .flags(vk::CommandPoolCreateFlags::RESET_COMMAND_BUFFER)
            .queue_family_index(self.queue_family_index);
        Ok(unsafe { self.device.create_command_pool(&pool_create_info, None)? })
    }

    pub fn create_command_buffer(&self, pool: vk::CommandPool) -> Result<vk::CommandBuffer> {
        let info = vk::CommandBufferAllocateInfo::default()
            .command_buffer_count(1)
            .command_pool(pool)
            .level(vk::CommandBufferLevel::PRIMARY);

        unsafe {
            self.device
                .allocate_command_buffers(&info)
                .map(|b| {
                    dbg!(&b);
                    b[0]
                })
                .map_err(anyhow::Error::from)
        }
    }

    pub fn reset_command_buffer(&self, cmd: vk::CommandBuffer) -> Result<()> {
        Ok(unsafe {
            self.device
                .reset_command_buffer(cmd, vk::CommandBufferResetFlags::default())?
        })
    }

    pub fn begin_command_buffer(&self, cmd: vk::CommandBuffer) -> Result<()> {
        let info = &vk::CommandBufferBeginInfo::default()
            .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT);
        Ok(unsafe { self.device.begin_command_buffer(cmd, info)? })
    }

    pub fn end_command_buffer(&self, cmd: vk::CommandBuffer) -> Result<()> {
        Ok(unsafe { self.device.end_command_buffer(cmd)? })
    }

    pub fn queue_submit(
        &self,
        cmd: &vk::CommandBuffer,
        wait_semaphore: &vk::Semaphore,
        signal_semaphore: &vk::Semaphore,
        fence: vk::Fence,
    ) -> Result<(), anyhow::Error> {
        let wait_info = &[vk::SemaphoreSubmitInfo::default()
            .semaphore(*wait_semaphore)
            .stage_mask(vk::PipelineStageFlags2::COLOR_ATTACHMENT_OUTPUT)
            .value(1)];
        let signal_info = &[vk::SemaphoreSubmitInfo::default()
            .semaphore(*signal_semaphore)
            .stage_mask(vk::PipelineStageFlags2::ALL_GRAPHICS)
            .value(1)];
        let command_buffer_info = &[vk::CommandBufferSubmitInfo::default()
            .command_buffer(*cmd)
            .device_mask(0)];
        let submit_info = &[vk::SubmitInfo2::default()
            .command_buffer_infos(command_buffer_info)
            .wait_semaphore_infos(wait_info)
            .signal_semaphore_infos(signal_info)];

        Ok(unsafe { self.device.queue_submit2(self.queue, submit_info, fence) }?)
    }
}

impl RenderBackend /* Swapchain */ {
    pub fn present(&mut self, semaphore: vk::Semaphore, image_index: u32) -> Result<()> {
        let wait_semaphores = &[semaphore];
        let indices = &[image_index];

        self.swapchain.queue_present(wait_semaphores, indices)
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
            queue_family_index: self.queue_family_index,
            queue: &self.queue,
            surface_fns: &self.surface_fns,
        });

        match result {
            Ok(swapchain) => {
                self.swapchain = swapchain;
                Ok(())
            }
            Err(err) => Err(anyhow::anyhow!(err)),
        }
    }
}

impl RenderBackend /* Images */ {
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
            self.device.cmd_pipeline_barrier2(buffer, &dependency_info);
        }
    }

    pub fn copy_image(
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

        unsafe { self.device.cmd_blit_image2(cmd, &blit_info) }
    }

    pub fn load_shader(&self, path: &str) -> Result<vk::ShaderModule> {
        let mut file = std::fs::File::open(path)?;
        let bytes = ash::util::read_spv(&mut file)?;
        let info = vk::ShaderModuleCreateInfo::default().code(&bytes);
        let shader = unsafe { self.device.create_shader_module(&info, None) }?;

        Ok(shader)
    }
}

impl fmt::Debug for RenderBackend {
    fn fmt(&self, f: &mut fmt::Formatter) -> std::fmt::Result {
        f.debug_struct("RenderBackend")
            .field("instance", &self.instance.handle())
            .field("physical_device", &self.physical_device.as_raw())
            .field("surface", &self.surface)
            .field("swapchain", &self.swapchain)
            .field("device", &self.device.handle())
            .finish()
    }
}
