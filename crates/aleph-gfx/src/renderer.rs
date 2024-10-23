use aleph_hal::vk::swapchain::Frame;
use anyhow::bail;
use ash::vk::{self, CommandBufferResetFlags, Extent2D};

use {aleph_hal::vk::render_backend::RenderBackend, anyhow::Result, std::fmt};

const TIMEOUT_NS: u64 = 1_000_000_000;

pub struct Renderer {
    backend: RenderBackend,
    frames: Vec<Frame>,
    current_frame_index: usize,
    extent: Extent2D,
}

impl fmt::Debug for Renderer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Renderer").finish_non_exhaustive()
    }
}

impl Renderer {
    pub fn new(backend: RenderBackend) -> Result<Self> {
        let frames = Self::init_frames(&backend)?;
        Ok(Renderer {
            backend,
            frames,
            current_frame_index: 0,
            extent: vk::Extent2D::default(), // {
                                             // width: 1,
                                             // height: 1,
                                             // },
        })
    }

    fn init_frames(backend: &RenderBackend) -> Result<Vec<Frame>> {
        (0..backend.swapchain.image_views.len())
            .map(|index| {
                let pool = backend.create_command_pool();
                Ok(Frame {
                    index,
                    swapchain_semaphore: backend.device.create_semaphore()?,
                    render_semaphore: backend.device.create_semaphore()?,
                    fence: backend.device.create_fence_signaled()?,
                    command_pool: pool,
                    command_buffer: backend.create_command_buffer(pool)?,
                })
            })
            .collect()
    }

    fn current_frame(&self) -> &Frame {
        &self.frames[self.current_frame_index]
    }

    pub fn render(&mut self) -> Result<()> {
        let RenderBackend {
            device, swapchain, ..
        } = &self.backend;
        let current_frame = self.current_frame();

        device.wait_for_fence(current_frame.fence)?;
        device.reset_fence(current_frame.fence)?;

        let index = self.next_frame(current_frame)?;
        let image = swapchain.images[index as usize];

        let cmd = current_frame.command_buffer;
        unsafe {
            self.backend
                .device
                .inner
                .reset_command_buffer(cmd, CommandBufferResetFlags::default())
        }?;

        let info = vk::CommandBufferBeginInfo::default()
            .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT);
        unsafe { self.backend.device.inner.begin_command_buffer(cmd, &info)? }

        self.backend.transition_image(
            cmd,
            image,
            vk::ImageLayout::UNDEFINED,
            vk::ImageLayout::GENERAL,
        );

        let flash = f32::abs(f32::sin(self.current_frame_index as f32 / 120.0));
        let color = vk::ClearColorValue {
            float32: [0.0, 0.0, flash, 1.0],
        };

        let ranges = [vk::ImageSubresourceRange {
            aspect_mask: vk::ImageAspectFlags::COLOR,
            base_mip_level: 0,
            level_count: 1,
            base_array_layer: 0,
            layer_count: 1,
        }];

        unsafe {
            self.backend.device.inner.cmd_clear_color_image(
                cmd,
                image,
                vk::ImageLayout::GENERAL,
                &color,
                &ranges,
            );
            self.backend.transition_image(
                cmd,
                image,
                vk::ImageLayout::GENERAL,
                vk::ImageLayout::PRESENT_SRC_KHR,
            );
            self.backend.device.inner.end_command_buffer(cmd)?;
        };

        let wait_info = &[vk::SemaphoreSubmitInfo::default()
            .semaphore(current_frame.swapchain_semaphore)
            .stage_mask(vk::PipelineStageFlags2::COLOR_ATTACHMENT_OUTPUT)];
        let signal_info = &[vk::SemaphoreSubmitInfo::default()
            .semaphore(current_frame.render_semaphore)
            .stage_mask(vk::PipelineStageFlags2::ALL_GRAPHICS)];
        let command_buffer_info = &[vk::CommandBufferSubmitInfo::default().command_buffer(cmd)];

        let submit_info = &[vk::SubmitInfo2::default()
            .command_buffer_infos(command_buffer_info)
            .wait_semaphore_infos(wait_info)
            .signal_semaphore_infos(signal_info)];

        unsafe {
            self.backend.device.inner.queue_submit2(
                self.backend.device.queue.inner,
                submit_info,
                current_frame.fence,
            )
        }?;

        let wait_semaphores = [current_frame.render_semaphore];
        let swapchains = [self.backend.swapchain.inner];
        let indices = [self.current_frame_index as u32];

        let present_info = vk::PresentInfoKHR::default()
            .wait_semaphores(&wait_semaphores)
            .swapchains(&swapchains)
            .image_indices(&indices);

        unsafe {
            let result = self
                .backend
                .swapchain
                .loader
                .queue_present(self.backend.device.queue.inner, &present_info);
            match result {
                Ok(_) => {}
                Err(vk::Result::ERROR_OUT_OF_DATE_KHR) => {
                    self.backend.resize(self.extent.width, self.extent.height)?;
                }
                Err(err) => bail!(err),
            }
        };

        self.current_frame_index = (self.current_frame_index + 1) % self.frames.len();

        Ok(())
    }

    pub fn resize(&mut self, width: u32, height: u32) -> Result<()> {
        self.backend.resize(width, height)
    }

    fn next_frame(&self, current_frame: &Frame) -> Result<u32> {
        let acquire_info = vk::AcquireNextImageInfoKHR::default()
            .swapchain(self.backend.swapchain.inner)
            .timeout(TIMEOUT_NS)
            .semaphore(current_frame.swapchain_semaphore)
            .device_mask(1)
            .fence(vk::Fence::null());
        let (index, _) = unsafe {
            self.backend
                .swapchain
                .loader
                .acquire_next_image2(&acquire_info)?
        };
        Ok(index)
    }
}
