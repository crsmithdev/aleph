use {
    super::{
        Allocator,
        Buffer,
        BufferInfo,
        CommandBuffer,
        CommandPool,
        DeletionQueue,
        Device,
        Image,
        ImageInfo,
        Instance,
        Swapchain,
        SwapchainInfo,
    },
    anyhow::Result,
    ash::{
        khr::{self},
        vk::{self, DescriptorSetLayoutCreateFlags, Handle},
    },
    derive_more::{Debug, Deref},
    raw_window_handle::{HasDisplayHandle, HasWindowHandle},
    std::{ffi, sync::Arc},
    winit::window::Window,
};

const IN_FLIGHT_FRAMES: u32 = 2;

#[derive(Clone, Debug)]
pub struct Surface {
    #[debug("{:x}", inner.as_raw())]
    pub(crate) inner: vk::SurfaceKHR,

    #[debug("{:x}", loader.instance().as_raw())]
    pub(crate) loader: khr::surface::Instance,
}

impl Surface {
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

#[allow(dead_code)]
#[derive(Debug)]
pub struct Gpu {
    pub(crate) instance: Instance,
    pub(crate) surface: Surface,
    pub(crate) device: Device,
    pub(crate) swapchain: Swapchain,
    pub(crate) allocator: Arc<Allocator>,
    pub(crate) window: Arc<Window>,
    setup_cmd_pool: CommandPool,
    setup_cmd_buffer: CommandBuffer,
}

impl Gpu {
    pub fn new(window: Arc<Window>) -> Result<Self> {
        let instance = Instance::new()?;
        let surface = Self::init_surface(&instance, &Arc::clone(&window))?;
        let device = Device::new(&instance)?;
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

        let allocator = Arc::new(Allocator::new(&instance, &device)?);
        let setup_cmd_pool = device.create_command_pool()?;
        let setup_cmd_buffer = setup_cmd_pool.create_command_buffer()?;

        Ok(Self {
            instance,
            device,
            surface,
            swapchain,
            allocator,
            setup_cmd_buffer,
            setup_cmd_pool,
            window: Arc::clone(&window),
        })
    }

    #[inline]
    pub fn device(&self) -> &Device {
        &self.device
    }

    #[inline]
    pub fn allocator(&self) -> &Arc<Allocator> {
        &self.allocator
    }

    #[inline]
    pub fn swapchain(&self) -> &Swapchain {
        &self.swapchain
    }
}

impl Gpu /* Init */ {
    fn init_surface(instance: &Instance, window: &winit::window::Window) -> Result<Surface> {
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
impl Gpu {
    pub fn create_buffer(&self, info: BufferInfo) -> Result<Buffer> {
        Buffer::new(self.allocator.clone(), &self.device, info)
    }

    pub fn create_image(&self, info: ImageInfo) -> Result<Image> {
        Image::new(self.allocator.clone(), &self.device, info)
    }

    #[inline]
    pub fn create_fence(&self) -> Result<vk::Fence> {
        self.device.create_fence()
    }

    #[inline]
    pub fn create_fence_signaled(&self) -> Result<vk::Fence> {
        self.device.create_fence_signaled()
    }

    #[inline]
    pub fn create_semaphore(&self) -> Result<vk::Semaphore> {
        self.device.create_semaphore()
    }

    #[inline]
    pub fn create_command_pool(&self) -> Result<CommandPool> {
        self.device.create_command_pool()
    }


    #[inline]
    pub fn create_descriptor_set_layout(
        &self,
        bindings: &[vk::DescriptorSetLayoutBinding],
        flags: vk::DescriptorSetLayoutCreateFlags,
    ) -> Result<vk::DescriptorSetLayout> {
        let flags = flags | DescriptorSetLayoutCreateFlags::PUSH_DESCRIPTOR_KHR;
        self.device.create_descriptor_set_layout(bindings, flags)
    }

    #[inline]
    pub fn wait_for_fence(&self, fence: vk::Fence) -> Result<()> {
        self.device.wait_for_fence(fence)
    }

    #[inline]
    pub fn reset_fence(&self, fence: vk::Fence) -> Result<()> {
        self.device.reset_fence(fence)
    }

    pub fn load_shader(&self, path: &str) -> Result<vk::ShaderModule> {
        let mut file = std::fs::File::open(path)?;
        let bytes = ash::util::read_spv(&mut file)?;
        self.device.create_shader_module(&bytes)
    }

    pub fn rebuild_swapchain(&mut self) -> Result<()> {
        unsafe { self.device.device_wait_idle() }?;

        let extent = vk::Extent2D {
            width: self.window.inner_size().width,
            height: self.window.inner_size().height,
        };

        self.swapchain.rebuild(extent)
    }

    pub fn with_setup_cb(&self, callback: impl FnOnce(&CommandBuffer) -> Result<()>) -> Result<()> {
        let cmd_buffer =  &self.setup_cmd_buffer;

        cmd_buffer.begin()?;
        callback(cmd_buffer)?;
        cmd_buffer.end()?;
        let command_buffer_info = &[vk::CommandBufferSubmitInfo::default()
        .command_buffer(cmd_buffer.handle)
        .device_mask(0)];
        let submit_info = &[vk::SubmitInfo2::default()
            .command_buffer_infos(command_buffer_info)];

        unsafe { self.device.handle().queue_submit2(self.device.queue.handle(), submit_info, vk::Fence::null())}?;
        unsafe { self.device.handle().device_wait_idle() }?;

        Ok(())
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

impl Drop for Gpu {
    fn drop(&mut self) {
        log::debug!("Dropping GPU");
    }
}