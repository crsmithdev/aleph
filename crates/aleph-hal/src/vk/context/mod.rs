pub mod device;
pub mod swapchain;

pub use {
    crate::vk::{
        CommandBuffer,
        DescriptorAllocator,
        MemoryAllocator,
    },
    device::{Device, Queue},
    gpu_allocator::vulkan::{Allocation, AllocationCreateDesc, AllocationScheme},
    swapchain::{Frame, Swapchain, SwapchainInfo},
    gpu_allocator::MemoryLocation,
    ash::vk::BufferUsageFlags,
};
use {
    aleph_core::constants::VK_TIMEOUT_NS,
    anyhow::{anyhow, Result},
    ash::{
        ext,
        khr,
        vk::{self, Handle},
    },
    derive_more::{Debug, Deref},
    raw_window_handle::{HasDisplayHandle, HasWindowHandle},
    std::{ffi, sync::Arc},
    winit::window::Window,
};

const IN_FLIGHT_FRAMES: u32 = 2;
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

#[derive(Clone, Debug, Deref)]
pub struct Instance {
    #[deref]
    #[debug("{:x}", inner.handle().as_raw())]
    pub(crate) inner: ash::Instance,

    #[debug(skip)]
    entry: ash::Entry,
}

impl Instance {
    pub fn inner(&self) -> &ash::Instance {
        &self.inner
    }
}

#[derive(Clone, Debug, Deref)]
pub struct Surface {
    #[deref]
    #[debug("{:x}", inner.as_raw())]
    pub(crate) inner: vk::SurfaceKHR,

    #[debug("{:x}", loader.instance().as_raw())]
    pub(crate) loader: khr::surface::Instance,
}

#[derive(Debug)]
pub struct BufferInfo {
    pub size: usize,
    pub usage: vk::BufferUsageFlags,
    pub location: gpu_allocator::MemoryLocation,
}

#[derive(Debug)]
pub struct Buffer {
    #[debug("{:x}", handle.as_raw())]
    pub (crate) handle: vk::Buffer,
    pub (crate) allocation: Allocation,
    pub (crate) info: BufferInfo,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub struct Context {
    pub(crate) instance: Instance,
    pub(crate) surface: Surface,
    pub device: Device,
    pub(crate) swapchain: Swapchain,
    pub(crate) allocator: Arc<MemoryAllocator>,
    pub(crate) window: Arc<Window>,

    #[debug(skip)]
    debug_utils: ext::debug_utils::Instance,
    #[debug(skip)]
    debug_callback: vk::DebugUtilsMessengerEXT,
}

impl Context {
    pub fn new(window: Arc<Window>) -> Result<Self> {
        Self::init_vulkan(window)
    }

    pub fn device(&self) -> &Device {
        &self.device
    }

    pub fn queue(&self) -> &Queue {
        &self.device.queue
    }

    pub fn allocator(&self) -> &Arc<MemoryAllocator> {
        &self.allocator
    }

    pub fn swapchain(&self) -> &Swapchain {
        &self.swapchain
    }

    pub fn swapchain_mut(&mut self) -> &mut Swapchain {
        &mut self.swapchain
    }

    pub fn window(&self) -> &Arc<Window> {
        &self.window
    }
}

impl Context /* Init */ {
    fn init_vulkan(window: Arc<Window>) -> Result<Context> {
        log::info!("Initializing Vulkan, window: {window:?}");

        let instance = Self::init_instance()?;
        log::info!("Created instance: {instance:?}");

        let (debug_utils, debug_callback) = Self::init_debug(&instance)?;

        let surface = Self::init_surface(&instance, &Arc::clone(&window))?;
        log::info!("Created surface: {surface:?}");

        let device = Device::new(&instance)?;
        log::info!("Created device: {device:?}");

        // let queue = Self::init_queue(&device, queue_family, queue_family_index);
        // log::info!("Created queue: {queue:?}");

        let extent = vk::Extent2D {
            width: window.inner_size().width,
            height: window.inner_size().height,
        };
        let swapchain = Swapchain::new(
            &instance,
            &device,
            &surface,
            Arc::clone(&window),
            &SwapchainInfo {
                extent,
                format: vk::Format::B8G8R8A8_UNORM,
                color_space: vk::ColorSpaceKHR::SRGB_NONLINEAR,
                vsync: true,
                num_images: IN_FLIGHT_FRAMES,
            },
        )?;
        log::info!("Created swapchain: {swapchain:?}");

        let allocator = Arc::new(MemoryAllocator::new(&instance, &device)?);
        log::info!("Created allocator: {allocator:?}");

        let _descriptor_allocator = Arc::new(DescriptorAllocator::new(
            &device.inner,
            &[vk::DescriptorPoolSize {
                ty: vk::DescriptorType::STORAGE_IMAGE,
                descriptor_count: 1,
            }],
            10,
        )?);

        Ok(Context {
            instance,
            device,
            surface,
            swapchain,
            allocator,
            window: Arc::clone(&window),
            debug_utils,
            debug_callback,
        })
    }

    fn init_instance() -> Result<Instance> {
        let entry = unsafe { ash::Entry::load() }?;
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

        let inner = unsafe { entry.create_instance(&instance_info, None)? };
        Ok(Instance { inner, entry })
    }

    fn init_debug(
        instance: &Instance,
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
        let debug_utils = ext::debug_utils::Instance::new(&instance.entry, instance);
        let debug_callback = unsafe {
            debug_utils
                .create_debug_utils_messenger(&debug_info, None)
                .unwrap()
        };

        Ok((debug_utils, debug_callback))
    }

    fn init_surface(instance: &Instance, window: &winit::window::Window) -> Result<Surface> {
        let inner: vk::SurfaceKHR = unsafe {
            ash_window::create_surface(
                &instance.entry,
                instance,
                window.display_handle()?.into(),
                window.window_handle()?.into(),
                None,
            )?
        };

        let loader = khr::surface::Instance::new(&instance.entry, instance);
        Ok(Surface { inner, loader })
    }

    fn init_queue_familiy(
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

    fn get_queue_family_index(
        instance: &ash::Instance,
        physical_device: &vk::PhysicalDevice,
        flags: vk::QueueFlags,
    ) -> Result<u32> {
        let queue_families =
            unsafe { instance.get_physical_device_queue_family_properties(*physical_device) };
        let selected = queue_families
            .into_iter()
            .enumerate()
            .find(|(_, qf)| qf.queue_flags.contains(flags));

        match selected {
            Some((index, _)) => Ok(index as u32),
            None => Err(anyhow!("Could not find queue family with flags: {flags:?}")),
        }
    }
}

impl Context {
    pub fn create_buffer(&self, size: usize, usage: BufferUsageFlags, location: MemoryLocation) -> Result<Buffer> {
        let info = BufferInfo{
            size,
            usage,
            location: MemoryLocation::GpuOnly,
        };

        let create_info = vk::BufferCreateInfo::default()
        .size(info.size as u64)
        .usage(info.usage);
    let buffer = unsafe { self.device.inner.create_buffer(&create_info, None) }?;

        self.allocator.allocate_buffer(BufferInfo{
            size,
            usage,
            location: MemoryLocation::GpuOnly,
        });

        unsafe {
            self.device
                .inner
                .bind_buffer_memory(buffer, allocation.memory(), allocation.offset())
        }?;

        Ok(Buffer {
            allocation,
            handle: buffer,
            info,
        })
    }
}
impl Context {
    pub fn create_image_view(&self, info: &vk::ImageViewCreateInfo) -> Result<vk::ImageView> {
        Ok(unsafe { self.device.inner.create_image_view(info, None) }?)
    }

    pub fn destroy_image_view(&self, view: vk::ImageView) {
        unsafe {
            self.device.inner.destroy_image_view(view, None);
        }
    }

    pub fn create_fence(&self) -> Result<vk::Fence> {
        Ok(unsafe {
            self.device
                .inner
                .create_fence(&vk::FenceCreateInfo::default(), None)?
        })
    }

    pub fn create_fence_signaled(&self) -> Result<vk::Fence> {
        Ok(unsafe {
            self.device.inner.create_fence(
                &vk::FenceCreateInfo::default().flags(vk::FenceCreateFlags::SIGNALED),
                None,
            )?
        })
    }

    pub fn wait_for_fence(&self, fence: vk::Fence) -> Result<()> {
        #[allow(clippy::unit_arg)]
        Ok(unsafe {
            self.device
                .inner
                .wait_for_fences(&[fence], true, VK_TIMEOUT_NS)?
        })
    }

    pub fn reset_fence(&self, fence: vk::Fence) -> Result<()> {
        #[allow(clippy::unit_arg)]
        Ok(unsafe { self.device.inner.reset_fences(&[fence])? })
    }

    pub fn create_semaphore(&self) -> Result<vk::Semaphore> {
        Ok(unsafe {
            self.device
                .inner
                .create_semaphore(&vk::SemaphoreCreateInfo::default(), None)?
        })
    }

    pub fn create_command_pool(&self) -> Result<vk::CommandPool> {
        let pool_create_info = vk::CommandPoolCreateInfo::default()
            .flags(vk::CommandPoolCreateFlags::RESET_COMMAND_BUFFER)
            .queue_family_index(self.device.queue.family_index);
        Ok(unsafe {
            self.device
                .inner
                .create_command_pool(&pool_create_info, None)?
        })
    }
}

impl Context /* Images */ {
    pub fn transition_image(
        &self,
        buffer: &CommandBuffer,
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
                .cmd_pipeline_barrier2(buffer.inner, &dependency_info);
        }
    }

    pub fn copy_image(
        &self,
        cmd: &CommandBuffer,
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

        unsafe { self.device.inner.cmd_blit_image2(cmd.inner, &blit_info) }
    }

    pub fn load_shader(&self, path: &str) -> Result<vk::ShaderModule> {
        let mut file = std::fs::File::open(path)?;
        let bytes = ash::util::read_spv(&mut file)?;
        let info = vk::ShaderModuleCreateInfo::default().code(&bytes);
        let shader = unsafe { self.device.inner.create_shader_module(&info, None) }?;

        Ok(shader)
    }

    pub fn update_descriptor_sets(
        &self,
        writes: &[vk::WriteDescriptorSet],
        copies: &[vk::CopyDescriptorSet],
    ) {
        unsafe {
            self.device.inner.update_descriptor_sets(writes, copies);
        }
    }

    pub fn create_descriptor_set_layout(
        &self,
        bindings: &[vk::DescriptorSetLayoutBinding],
        flags: vk::DescriptorSetLayoutCreateFlags,
    ) -> Result<vk::DescriptorSetLayout> {
        let info = vk::DescriptorSetLayoutCreateInfo::default()
            .bindings(bindings)
            .flags(flags);
        Ok(unsafe {
            self.device
                .inner
                .create_descriptor_set_layout(&info, None)?
        })
    }
}

#[allow(clippy::missing_safety_doc)]
pub unsafe extern "system" fn vulkan_debug_callback(
    message_severity: vk::DebugUtilsMessageSeverityFlagsEXT,
    _message_type: vk::DebugUtilsMessageTypeFlagsEXT,
    p_callback_data: *const vk::DebugUtilsMessengerCallbackDataEXT,
    _p_user_data: *mut ffi::c_void,
) -> vk::Bool32 {
    let message = ffi::CStr::from_ptr((*p_callback_data).p_message)
        .to_str()
        .unwrap_or("[Error parsing message data]");

    match message_severity {
        vk::DebugUtilsMessageSeverityFlagsEXT::ERROR => log::error!("{}", message),
        vk::DebugUtilsMessageSeverityFlagsEXT::WARNING => log::warn!("{}", message),
        vk::DebugUtilsMessageSeverityFlagsEXT::VERBOSE => log::trace!("{}", message),
        _ => log::info!("{}", message),
    }

    vk::FALSE
}
