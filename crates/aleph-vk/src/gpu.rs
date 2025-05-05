use {
    crate::{
        AllocatedTexture, Allocator, Buffer, CommandBuffer, CommandPool, Device, Instance,
        MemoryLocation, Swapchain, SwapchainInfo, VK_TIMEOUT_NS,
    },
    aleph_core::log,
    anyhow::Result,
    ash::{
        khr,
        vk::{
            self, DescriptorPoolCreateFlags, Filter, Handle, SamplerAddressMode, SamplerMipmapMode,
        },
    },
    bytemuck::Pod,
    derive_more::Debug,
    raw_window_handle::{HasDisplayHandle, HasWindowHandle},
    std::{cell::UnsafeCell, ffi, slice, sync::Arc},
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
    pub(crate) swapchain: UnsafeCell<Swapchain>,
    pub(crate) allocator: Arc<Allocator>,
    pub(crate) window: Arc<Window>,
    setup_cmd_pool: CommandPool,
    setup_cmd_buffer: CommandBuffer,
}

impl Gpu {
    pub fn new(window: Arc<Window>) -> Result<Self> {
        let instance = Instance::new()?;
        let surface = Self::init_surface(&instance, Arc::clone(&window))?;
        let device = Device::new(&instance)?;
        let extent = vk::Extent2D {
            width: window.inner_size().width,
            height: window.inner_size().height,
        };
        let swapchain = UnsafeCell::new(Swapchain::new(
            &instance,
            &device,
            &surface,
            &SwapchainInfo {
                extent,
                format: vk::Format::B8G8R8A8_SRGB,
                color_space: vk::ColorSpaceKHR::SRGB_NONLINEAR,
                vsync: true,
                num_images: IN_FLIGHT_FRAMES,
            },
        )?);

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
    pub fn window(&self) -> Arc<Window> { self.window.clone() }

    #[inline]
    pub fn instance(&self) -> &Instance { &self.instance }

    #[inline]
    pub fn device(&self) -> &Device { &self.device }

    #[inline]
    pub fn allocator(&self) -> Arc<Allocator> { Arc::clone(&self.allocator) }

    #[inline]
    pub fn swapchain(&self) -> &Swapchain { unsafe { &*self.swapchain.get() } }
}

impl Gpu /* Init */ {
    fn init_surface(instance: &Instance, window: Arc<winit::window::Window>) -> Result<Surface> {
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
    pub fn create_shared_buffer<T: Pod>(
        &self,
        size: u64,
        flags: vk::BufferUsageFlags,
        label: impl Into<String>,
    ) -> Result<Buffer<T>> {
        Buffer::new(
            &self.device,
            Arc::clone(&self.allocator),
            size,
            flags,
            MemoryLocation::CpuToGpu,
            label,
        )
    }
    pub fn create_pipeline_layout(
        &self,
        uniforms_layouts: &[vk::DescriptorSetLayout],
        constants_ranges: &[vk::PushConstantRange],
    ) -> Result<vk::PipelineLayout> {
        let pipeline_layout_info = vk::PipelineLayoutCreateInfo::default()
            .set_layouts(uniforms_layouts)
            .push_constant_ranges(constants_ranges);
        Ok(unsafe {
            self.device
                .handle
                .create_pipeline_layout(&pipeline_layout_info, None)?
        })
    }

    pub fn create_graphics_pipeline(
        &self,
        info: &vk::GraphicsPipelineCreateInfo,
    ) -> Result<vk::Pipeline> {
        Ok(unsafe {
            self.device
                .handle
                .create_graphics_pipelines(vk::PipelineCache::null(), slice::from_ref(info), None)
                .map_err(|err| anyhow::anyhow!(err.1))
        }?[0])
    }

    pub fn create_semaphore(&self) -> Result<vk::Semaphore> {
        #[allow(clippy::unit_arg)]
        Ok(unsafe {
            self.device
                .handle
                .create_semaphore(&vk::SemaphoreCreateInfo::default(), None)?
        })
    }

    pub fn create_command_pool(&self) -> Result<CommandPool> { self.device.create_command_pool() }

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
                .handle
                .create_descriptor_set_layout(&info, None)?
        })
    }

    pub fn create_descriptor_pool(
        &self,
        pool_sizes: &[vk::DescriptorPoolSize],
        flags: vk::DescriptorPoolCreateFlags,
        max_sets: u32,
    ) -> Result<vk::DescriptorPool> {
        let info = vk::DescriptorPoolCreateInfo::default()
            .pool_sizes(pool_sizes)
            .max_sets(max_sets)
            .flags(flags);
        Ok(unsafe { self.device.handle.create_descriptor_pool(&info, None)? })
    }

    pub fn create_descriptor_set(
        &self,
        layout: vk::DescriptorSetLayout,
        pool: vk::DescriptorPool,
    ) -> Result<vk::DescriptorSet> {
        let info = vk::DescriptorSetAllocateInfo::default()
            .descriptor_pool(pool)
            .set_layouts(slice::from_ref(&layout));
        Ok(unsafe { self.device.handle.allocate_descriptor_sets(&info)?[0] })
    }

    pub fn update_descriptor_sets(
        &self,
        writes: &[vk::WriteDescriptorSet],
        copies: &[vk::CopyDescriptorSet],
    ) -> Result<()> {
        self.device.update_descriptor_sets(writes, copies)
    }

    pub fn create_fence(&self) -> Result<vk::Fence> {
        self.device.create_fence(vk::FenceCreateFlags::empty())
    }

    pub fn create_fence_signaled(&self) -> Result<vk::Fence> {
        self.device.create_fence(vk::FenceCreateFlags::SIGNALED)
    }

    pub fn wait_for_fence(&self, fence: vk::Fence) -> Result<()> {
        #[allow(clippy::unit_arg)]
        Ok(unsafe {
            self.device
                .handle
                .wait_for_fences(&[fence], true, VK_TIMEOUT_NS)?
        })
    }

    pub fn reset_fence(&self, fence: vk::Fence) -> Result<()> {
        #[allow(clippy::unit_arg)]
        Ok(unsafe { self.device.handle.reset_fences(&[fence])? })
    }

    pub fn create_shader_module(&self, path: &str) -> Result<vk::ShaderModule> {
        let mut file = std::fs::File::open(path)?;
        let bytes = ash::util::read_spv(&mut file)?;
        let info = vk::ShaderModuleCreateInfo::default().code(&bytes);
        let module = unsafe { self.device.handle.create_shader_module(&info, None) }?;
        Ok(module)
    }

    pub fn rebuild_swapchain(&self) -> Result<()> {
        unsafe { self.device.handle.device_wait_idle() }?;

        let extent = vk::Extent2D {
            width: self.window.inner_size().width,
            height: self.window.inner_size().height,
        };

        let swapchain = unsafe { &mut *self.swapchain.get() };
        swapchain.rebuild(extent)
    }

    pub fn create_texture(
        &self,
        extent: vk::Extent2D,
        format: vk::Format,
        usage: vk::ImageUsageFlags,
        aspect_flags: vk::ImageAspectFlags,
        label: impl Into<String>,
        sampler: Option<vk::Sampler>,
    ) -> Result<AllocatedTexture> {
        AllocatedTexture::new(
            self.device.clone(),
            Arc::clone(&self.allocator),
            extent,
            format,
            usage,
            aspect_flags,
            label,
            sampler,
        )
    }

    pub fn create_sampler(
        &self,
        min_filter: Filter,
        mag_filter: Filter,
        mipmap_mode: SamplerMipmapMode,
        address_mode_u: SamplerAddressMode,
        address_mode_y: SamplerAddressMode,
    ) -> Result<vk::Sampler> {
        self.device.create_sampler(
            min_filter,
            mag_filter,
            mipmap_mode,
            address_mode_u,
            address_mode_y,
        )
    }

    pub fn execute(&self, callback: impl FnOnce(&CommandBuffer)) -> Result<()> {
        let cmd_buffer = &self.setup_cmd_buffer;

        cmd_buffer.reset()?;
        cmd_buffer.begin()?;
        callback(cmd_buffer);
        cmd_buffer.end()?;
        let command_buffer_info = &[vk::CommandBufferSubmitInfo::default()
            .command_buffer(cmd_buffer.handle)
            .device_mask(0)];
        let submit_info = &[vk::SubmitInfo2::default().command_buffer_infos(command_buffer_info)];

        unsafe {
            self.device.handle().queue_submit2(
                self.device.queue.handle(),
                submit_info,
                vk::Fence::null(),
            )
        }?;
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
