use {
    crate::{
        CommandBuffer,
        DescriptorAllocator,
        Device,
        Instance,
        MemoryAllocator,
        Queue,
        Swapchain,
        SwapchainInfo,
    },
    anyhow::Result,
    ash::{
        khr::{self},
        vk::{self, Handle},
    },
    derive_more::{Debug, Deref},
    raw_window_handle::{HasDisplayHandle, HasWindowHandle},
    std::{ffi, sync::Arc},
    winit::window::Window,
};

const IN_FLIGHT_FRAMES: u32 = 2;

#[derive(Clone, Debug, Deref)]
pub struct Surface {
    #[deref]
    #[debug("{:x}", inner.as_raw())]
    pub(crate) inner: vk::SurfaceKHR,

    #[debug("{:x}", loader.instance().as_raw())]
    pub(crate) loader: khr::surface::Instance,
}

#[allow(dead_code)]
#[derive(Debug)]
pub struct Context {
    pub(crate) instance: Instance,
    pub(crate) surface: Surface,
    pub(crate) device: Device,
    pub(crate) swapchain: Swapchain,
    pub(crate) memory_allocator: Arc<MemoryAllocator>,
    pub(crate) descriptor_allocator: Arc<DescriptorAllocator>,
    pub(crate) window: Arc<Window>,
}

impl Context {
    pub fn new(window: Arc<Window>) -> Result<Self> {
        Self::init_vulkan(window)
    }

    #[inline]
    pub fn device(&self) -> &Device {
        &self.device
    }

    #[inline]
    pub fn queue(&self) -> &Queue {
        &self.device.queue
    }

    pub fn memory_allocator(&self) -> &Arc<MemoryAllocator> {
        &self.memory_allocator
    }

    pub fn descriptor_allocator(&self) -> &Arc<DescriptorAllocator> {
        &self.descriptor_allocator
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

        let instance = Instance::new()?;
        log::info!("Created instance: {instance:?}");

        let surface = Self::create_surface(&instance, &Arc::clone(&window))?;
        log::info!("Created surface: {surface:?}");

        let device = Device::new(&instance)?;
        log::info!("Created device: {device:?}");

        let extent = vk::Extent2D {
            width: window.inner_size().width,
            height: window.inner_size().height,
        };
        let swapchain = Swapchain::new(
            &instance,
            &device,
            &surface,
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

        let descriptor_allocator = Arc::new(DescriptorAllocator::new(
            &device,
            &[vk::DescriptorPoolSize {
                ty: vk::DescriptorType::STORAGE_IMAGE,
                descriptor_count: 1,
            }],
            10,
        )?);
        log::info!("Created descriptor allocator: {:?}", &descriptor_allocator);

        Ok(Context {
            instance,
            device,
            surface,
            swapchain,
            memory_allocator: allocator,
            descriptor_allocator,
            window: Arc::clone(&window),
        })
    }

    fn create_surface(instance: &Instance, window: &winit::window::Window) -> Result<Surface> {
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
        Ok(Surface { inner, loader })
    }
}

impl Context {
    #[inline]
    pub fn create_fence(&self) -> Result<vk::Fence> {
        self.device.create_fence()
    }

    #[inline]
    pub fn create_fence_signaled(&self) -> Result<vk::Fence> {
        self.device.create_fence_signaled()
    }

    #[inline]
    pub fn wait_for_fence(&self, fence: vk::Fence) -> Result<()> {
        self.device.wait_for_fence(fence)
    }

    #[inline]
    pub fn reset_fence(&self, fence: vk::Fence) -> Result<()> {
        self.device.reset_fence(fence)
    }

    #[inline]
    pub fn create_semaphore(&self) -> Result<vk::Semaphore> {
        self.device.create_semaphore()
    }

    #[inline]
    pub fn create_command_pool(&self) -> Result<vk::CommandPool> {
        self.device.create_command_pool()
    }

    #[inline]
    pub fn create_command_buffer(&self, pool: vk::CommandPool) -> Result<CommandBuffer> {
        self.device.create_command_buffer(pool)
    }

    pub fn update_descriptor_sets(
        &self,
        writes: &[vk::WriteDescriptorSet],
        copies: &[vk::CopyDescriptorSet],
    ) {
        self.device.update_descriptor_sets(writes, copies);
    }

    pub fn create_descriptor_set_layout(
        &self,
        bindings: &[vk::DescriptorSetLayoutBinding],
        flags: vk::DescriptorSetLayoutCreateFlags,
    ) -> Result<vk::DescriptorSetLayout> {
        self.device.create_descriptor_set_layout(bindings, flags)
    }
}

impl Context /* Images */ {
    pub fn load_shader(&self, path: &str) -> Result<vk::ShaderModule> {
        let mut file = std::fs::File::open(path)?;
        let bytes = ash::util::read_spv(&mut file)?;
        let info = vk::ShaderModuleCreateInfo::default().code(&bytes);
        let shader = unsafe { self.device.create_shader_module(&info, None) }?;

        Ok(shader)
    }

    pub fn rebuild_swapchain(&mut self) -> Result<()> {
        unsafe { self.device.device_wait_idle() }?;

        let extent = vk::Extent2D {
            width: self.window.inner_size().width,
            height: self.window.inner_size().height,
        };

        self.swapchain.rebuild(extent)
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
