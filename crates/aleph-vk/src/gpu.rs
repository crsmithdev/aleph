use {
    crate::{
        debug::DebugUtils, swapchain::Surface, Allocator, CommandBuffer, CommandPool, Device,
        Instance, Queue, Swapchain, SwapchainInfo,
    },
    aleph_core::log,
    anyhow::Result,
    ash::vk::{self, CommandBufferSubmitInfo, Extent2D},
    derive_more::Debug,
    std::{ffi, sync::Arc},
    tracing::instrument,
    winit::window::Window,
};

const IN_FLIGHT_FRAMES: usize = 2;

#[allow(dead_code)]
#[derive(Debug)]
pub struct Gpu {
    pub(crate) instance: Instance,
    pub(crate) surface: Surface,
    pub(crate) device: Device,
    pub(crate) swapchain: Swapchain,
    pub(crate) allocator: Arc<Allocator>,
    pub(crate) debug_utils: DebugUtils,
    immediate_cmd_pool: CommandPool,
    immediate_cmd_buffer: CommandBuffer,
    imm_fence: vk::Fence,
}

impl Gpu {
    pub fn new(window: Arc<Window>) -> Result<Self> {
        let instance = Instance::new()?;
        let device = Device::new(&instance)?;
        let debug_utils = DebugUtils::new(&instance, &device);
        let extent = vk::Extent2D {
            width: window.inner_size().width,
            height: window.inner_size().height,
        };

        let surface = Surface::new(&instance, &window)?;
        let swapchain = Swapchain::new(
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
        )?;

        let imm_fence = device.create_fence(vk::FenceCreateFlags::SIGNALED);
        let allocator = Arc::new(Allocator::new(&instance, &device)?);
        let imm_cmd_pool = CommandPool::new(&device, device.graphics_queue(), "immediate");
        let imm_cmd_buffer = imm_cmd_pool.create_command_buffer("immediate");

        Ok(Self {
            surface,
            swapchain,
            allocator,
            debug_utils,
            immediate_cmd_buffer: imm_cmd_buffer,
            immediate_cmd_pool: imm_cmd_pool,
            instance,
            device,
            imm_fence,
        })
    }

    pub fn headless() -> Result<Self> {
        let instance = Instance::new()?;
        let device = Device::new(&instance)?;
        let debug_utils = DebugUtils::new(&instance, &device);

        let imm_fence = device.create_fence(vk::FenceCreateFlags::SIGNALED);
        let surface = Surface::headless(&instance);
        let swapchain = Swapchain::headless(&instance, &device)?;
        let allocator = Arc::new(Allocator::new(&instance, &device)?);
        let imm_cmd_pool = CommandPool::new(&device, device.graphics_queue(), "immediate");
        let imm_cmd_buffer = imm_cmd_pool.create_command_buffer("immediate");

        Ok(Self {
            instance,
            device,
            debug_utils,
            surface,
            swapchain,
            allocator,
            immediate_cmd_buffer: imm_cmd_buffer,
            immediate_cmd_pool: imm_cmd_pool,
            imm_fence,
        })
    }

    #[inline]
    pub fn immediate_cmd_pool(&self) -> &CommandPool { &self.immediate_cmd_pool }

    #[inline]
    pub fn immediate_cmd_buffer(&self) -> &CommandBuffer { &self.immediate_cmd_buffer }

    #[inline]
    pub fn immediate_fence(&self) -> vk::Fence { self.imm_fence }

    #[inline]
    pub fn debug_utils(&self) -> &DebugUtils { &self.debug_utils }

    #[inline]
    pub fn instance(&self) -> &Instance { &self.instance }

    #[inline]
    pub fn device(&self) -> &Device { &self.device }

    #[inline]
    pub fn allocator(&self) -> Arc<Allocator> { Arc::clone(&self.allocator) }

    #[inline]
    pub fn swapchain(&self) -> &Swapchain { &self.swapchain }
}

impl Gpu {
    pub fn rebuild_swapchain(&self, extent: Extent2D) {
        self.device.wait_idle();
        self.swapchain.rebuild(extent)
    }

    pub fn queue_submit(
        &self,
        queue: &Queue,
        command_buffers: &[&CommandBuffer],
        wait_semaphores: &[(vk::Semaphore, vk::PipelineStageFlags2)],
        signal_semaphores: &[(vk::Semaphore, vk::PipelineStageFlags2)],
        fence: vk::Fence,
    ) {
        log::trace!(
            "Submitting {:?} to {:?}, wait_semaphores: {:?}, signal_semaphores: {:?}, fence: {:?}",
            command_buffers,
            queue,
            wait_semaphores,
            signal_semaphores,
            fence
        );

        let cmd_infos = command_buffers
            .iter()
            .map(|cb| vk::CommandBufferSubmitInfo::default().command_buffer(***cb))
            .collect::<Vec<_>>();
        let wait_semaphore_infos = wait_semaphores
            .iter()
            .map(|(s, f)| vk::SemaphoreSubmitInfo::default().semaphore(*s).stage_mask(*f))
            .collect::<Vec<_>>();
        let signal_semaphore_infos = signal_semaphores
            .iter()
            .map(|(s, f)| vk::SemaphoreSubmitInfo::default().semaphore(*s).stage_mask(*f))
            .collect::<Vec<_>>();

        self.device.queue_submit(
            queue,
            &cmd_infos,
            &wait_semaphore_infos,
            &signal_semaphore_infos,
            fence,
        )
    }

    #[instrument(skip_all)]
    pub fn execute(&self, callback: impl FnOnce(&CommandBuffer)) {
        let cmd_buffer = &self.immediate_cmd_buffer;
        let fence = vk::Fence::null(); // self.imm_fence;
        log::trace!("Executing {cmd_buffer:?} with fences: {fence:?}");

        // self.device.wait_for_fences(&[fence]);
        // self.device.reset_fences(&[fence]);

        cmd_buffer.reset();
        cmd_buffer.begin();
        callback(cmd_buffer);
        cmd_buffer.end();
        let cmd_infos = &[CommandBufferSubmitInfo::default().command_buffer(**cmd_buffer)];

        self.device.queue_submit(self.device.graphics_queue(), cmd_infos, &[], &[], fence);
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
    #[cfg(feature = "gpu-tests")]
    fn test_headless() {
        let gpu = Gpu::headless();
        assert!(gpu.is_ok());
    }
}
