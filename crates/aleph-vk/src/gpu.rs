use {
    crate::{
        Allocator, CommandBuffer, CommandPool, Device, Instance, Swapchain, SwapchainInfo,
        VK_TIMEOUT_NS,
    },
    aleph_core::log,
    anyhow::Result,
    ash::{
        khr::{self},
        vk::{
            self, Extent2D, Filter, Handle, PhysicalDeviceProperties, SamplerAddressMode,
            SamplerMipmapMode, TextureLODGatherFormatPropertiesAMD,
        },
    },
    derive_more::Debug,
    raw_window_handle::{HasDisplayHandle, HasWindowHandle},
    std::{cell::UnsafeCell, ffi, slice, sync::Arc},
    tracing::instrument,
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
    pub fn headless(instance: &Instance) -> Self {
        Self {
            inner: vk::SurfaceKHR::null(),
            loader: khr::surface::Instance::new(&instance.entry, &instance.handle),
        }
    }

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
    immediate_cmd_pool: CommandPool,
    immediate_cmd_buffer: CommandBuffer,
    imm_fence: vk::Fence,
    properties: PhysicalDeviceProperties,
}

impl Gpu {
    pub fn new(window: Arc<Window>) -> Result<Self> {
        let instance = Instance::new()?;
        let device = Device::new(&instance)?;
        let extent = vk::Extent2D {
            width: window.inner_size().width,
            height: window.inner_size().height,
        };

        let surface = Self::init_surface(&instance, Arc::clone(&window))?;
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

        let imm_fence = device.create_fence(vk::FenceCreateFlags::SIGNALED);
        let allocator = Arc::new(Allocator::new(&instance, &device)?);
        let setup_cmd_pool = device.create_command_pool(device.graphics_queue(), "setup");
        let setup_cmd_buffer = setup_cmd_pool.create_command_buffer()?;
        let properties = instance.get_physical_device_properties(device.physical_device);

        Ok(Self {
            surface,
            swapchain,
            allocator,
            immediate_cmd_buffer: setup_cmd_buffer,
            immediate_cmd_pool: setup_cmd_pool,
            properties,
            instance,
            device,
            imm_fence,
        })
    }

    pub fn headless() -> Result<Self> {
        let instance = Instance::new()?;
        let device = Device::new(&instance)?;

        // let surface = Self::init_surface(&instance, Arc::clone(&window))?;
        // let swapchain = UnsafeCell::new(Swapchain::new(
        //     &instance,
        //     &device,
        //     &surface,
        //     &SwapchainInfo {
        //         extent,
        //         format: vk::Format::B8G8R8A8_SRGB,
        //         color_space: vk::ColorSpaceKHR::SRGB_NONLINEAR,
        //         vsync: true,
        //         num_images: IN_FLIGHT_FRAMES,
        //     },
        // )?);

        let imm_fence = device.create_fence(vk::FenceCreateFlags::SIGNALED);
        let surface = Surface::headless(&instance);
        let swapchain = UnsafeCell::new(Swapchain::headless(&instance, &device)?);
        let allocator = Arc::new(Allocator::new(&instance, &device)?);
        let setup_cmd_pool = device.create_command_pool(device.graphics_queue(), "setup");
        let setup_cmd_buffer = setup_cmd_pool.create_command_buffer()?;
        let properties = instance.get_physical_device_properties(device.physical_device);

        Ok(Self {
            instance,
            device,
            surface,
            swapchain,
            allocator,
            immediate_cmd_buffer: setup_cmd_buffer,
            immediate_cmd_pool: setup_cmd_pool,
            properties,
            imm_fence,
        })
    }

    #[inline]
    pub fn instance(&self) -> &Instance { &self.instance }

    #[inline]
    pub fn device(&self) -> &Device { &self.device }

    #[inline]
    pub fn allocator(&self) -> Arc<Allocator> { Arc::clone(&self.allocator) }

    #[inline]
    pub fn swapchain(&self) -> &Swapchain { unsafe { &*self.swapchain.get() } }

    #[inline]
    pub fn properties(&self) -> &PhysicalDeviceProperties { &self.properties }
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

    pub fn create_command_pool(&self) -> CommandPool {
        self.device
            .create_command_pool(self.device.graphics_queue(), "name")
    }

    pub fn create_descriptor_set_layout(
        &self,
        bindings: &[vk::DescriptorSetLayoutBinding],
        create_flags: vk::DescriptorSetLayoutCreateFlags,
        binding_flags: &[vk::DescriptorBindingFlags],
    ) -> Result<vk::DescriptorSetLayout> {
        let mut binding_flags_info =
            vk::DescriptorSetLayoutBindingFlagsCreateInfo::default().binding_flags(binding_flags);
        let create_info = vk::DescriptorSetLayoutCreateInfo::default()
            .bindings(bindings)
            .flags(create_flags)
            .push_next(&mut binding_flags_info);

        Ok(unsafe {
            self.device
                .handle
                .create_descriptor_set_layout(&create_info, None)?
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
        variable_descriptor_count: Option<u32>,
    ) -> Result<vk::DescriptorSet> {
        let mut descriptor_set_info = vk::DescriptorSetAllocateInfo::default()
            .descriptor_pool(pool)
            .set_layouts(slice::from_ref(&layout));

        let counts = [variable_descriptor_count.unwrap_or(0)];
        let mut count_info = vk::DescriptorSetVariableDescriptorCountAllocateInfo::default()
            .descriptor_counts(&counts);

        if variable_descriptor_count.is_some() {
            descriptor_set_info = descriptor_set_info.push_next(&mut count_info);
        }

        Ok(unsafe {
            self.device
                .handle
                .allocate_descriptor_sets(&descriptor_set_info)?[0]
        })
    }

    pub fn update_descriptor_sets(
        &self,
        writes: &[vk::WriteDescriptorSet],
        copies: &[vk::CopyDescriptorSet],
    ) -> Result<()> {
        self.device.update_descriptor_sets(writes, copies)
    }

    pub fn create_fence(&self) -> vk::Fence {
        self.device.create_fence(vk::FenceCreateFlags::empty())
    }

    pub fn create_fence_signaled(&self) -> vk::Fence {
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

    pub fn rebuild_swapchain(&self, extent: Extent2D) -> Result<()> {
        unsafe { self.device.handle.device_wait_idle() }?;
        let swapchain = unsafe { &mut *self.swapchain.get() };
        swapchain.rebuild(extent)
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

    #[instrument(skip_all)]
    pub fn execute(&self, callback: impl FnOnce(&CommandBuffer)) -> Result<()> {
        let cmd_buffer = &self.immediate_cmd_pool.create_command_buffer()?;
        // self.wait_for_fence(self.imm_fence);

        cmd_buffer.begin()?;
        callback(cmd_buffer);
        cmd_buffer.end()?;
        let command_buffer_info = &[vk::CommandBufferSubmitInfo::default()
            .command_buffer(cmd_buffer.handle)
            .device_mask(0)];
        let submit_info = &[vk::SubmitInfo2::default().command_buffer_infos(command_buffer_info)];

        unsafe {
            self.device.handle().queue_submit2(
                self.device.graphics_queue().handle(),
                submit_info,
                vk::Fence::null(),
                // self.imm_fence,
            )
        }?;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_headless() {
        let gpu = Gpu::headless();
        assert!(gpu.is_ok());
    }
}
