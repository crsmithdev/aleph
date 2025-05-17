use {
    crate::{
        sync, AccessFlags2, Allocator, Buffer, BufferUsageFlags, CommandBuffer, Device, Gpu, Image,
        MemoryLocation, PipelineStageFlags2, Queue, TypedBuffer,
    },
    anyhow::Result,
    ash::vk::{
        Fence, FenceCreateFlags, ImageAspectFlags, ImageLayout, ImageMemoryBarrier2,
        ImageSubresourceRange, QUEUE_FAMILY_IGNORED,
    },
    bytemuck::Pod,
    derive_more::{derive::Debug, Deref},
    std::{cell::RefCell, rc::Rc, slice, sync::Arc},
};

type BufferPool = RefCell<Vec<Rc<StagingBuffer>>>;

#[derive(Debug, Deref)]
struct StagingBuffer {
    #[deref]
    buffer: Buffer,
    expires: usize,
}

#[derive(Debug)]
pub struct Uploader {
    device: Device,
    allocator: Arc<Allocator>,
    pool_size: usize,
    retention: usize,
    retained_size: u64,
    buffer_pool: BufferPool,
    transfer_cmds: Vec<CommandBuffer>,
    graphics_cmds: Vec<CommandBuffer>,
    gfx_fences: Vec<Fence>,
    transfer_fences: Vec<Fence>,
    transfer_queue: Queue,
    graphics_queue: Queue,
    enqueued: usize,
    frame: usize,
}

impl Uploader {
    pub fn new(
        gpu: &Gpu,
        pool_size: usize,
        frames_retained: usize,
        retained_size: u64,
    ) -> Result<Self> {
        let allocator = Arc::clone(&gpu.allocator());
        let device = gpu.device().clone();

        let transfer_pool =
            device.create_command_pool(&gpu.device.transfer_queue, "upload-transfer")?;
        let graphics_pool = device.create_command_pool(&gpu.device.gfx_queue, "upload-gfx")?;
        let mut transfer_cmds = Vec::new();
        let mut graphics_cmds = Vec::new();

        for i in 0..pool_size {
            let mut transfer = transfer_pool.create_command_buffer(&format!("upload-tx{i}"));
            let mut graphics = graphics_pool.create_command_buffer(&format!("upload-gfx{i}"));
            let semaphore = device.create_semaphore();
            transfer.signal_semaphore(semaphore);
            graphics.wait_semaphore(semaphore);
            transfer_cmds.push(transfer);
            graphics_cmds.push(graphics);
        }
        let transfer_queue = gpu.device.transfer_queue;
        let graphics_queue = gpu.device.gfx_queue;
        let mut gfx_fences = Vec::new();
        let mut transfer_fences = Vec::new();
        for i in 0..frames_retained {
            transfer_fences.push(device.create_fence(FenceCreateFlags::default()));
            gfx_fences.push(device.create_fence(FenceCreateFlags::default()));
        }

        let uploader = Self {
            device,
            allocator,
            buffer_pool: RefCell::new(Vec::new()),
            transfer_cmds,
            graphics_queue,
            transfer_queue,
            graphics_cmds,
            enqueued: 0,
            frame: 0,
            gfx_fences,
            transfer_fences,
            pool_size,
            retained_size,
            retention: frames_retained,
        };

        Ok(uploader)
    }

    fn next_staging_buffer(&self, size: u64) -> Rc<StagingBuffer> {
        let found = {
            let pool = self.buffer_pool.borrow();
            pool.iter()
                .position(|b| b.size() >= size && b.expires < self.frame)
        };

        match found {
            Some(index) => {
                let mut pool = self.buffer_pool.borrow_mut();
                let staging = Rc::get_mut(&mut pool[index]).unwrap_or_else(|| {
                    panic!("Failed to get inner buffer from Rc");
                });
                staging.expires = self.frame + self.retention;
                Rc::clone(&pool[index])
            }
            None => {
                let mut pool = self.buffer_pool.borrow_mut();
                pool.push(Rc::new(StagingBuffer {
                    expires: self.frame + self.retention,
                    buffer: Buffer::new(
                        &self.device,
                        &self.allocator,
                        size.max(self.retained_size),
                        BufferUsageFlags::TRANSFER_SRC,
                        MemoryLocation::CpuToGpu,
                        "uploader",
                    )
                    .unwrap_or_else(|e| {
                        panic!("Error creating staging buffer of size {}: {:?}", size, e);
                    }),
                }));
                Rc::clone(&pool[pool.len() - 1])
            }
        }
    }

    pub fn enqueue_image(&mut self, image: &Image, data: &[u8]) {
        log::debug!("Enqueueing upload for ({:?})", image);

        let size = data.len() as u64;
        let transfer_rec = &self.transfer_cmds[self.frame % self.retention].record(&self.device);

        let staging = self.next_staging_buffer(size);
        staging.write(data);

        let pre_barrier = sync::image_memory_barrier(
            image,
            PipelineStageFlags2::TOP_OF_PIPE,
            AccessFlags2::NONE,
            PipelineStageFlags2::TRANSFER,
            AccessFlags2::TRANSFER_WRITE,
            ImageAspectFlags::COLOR,
            ImageLayout::UNDEFINED,
            ImageLayout::TRANSFER_DST_OPTIMAL,
            QUEUE_FAMILY_IGNORED,
            QUEUE_FAMILY_IGNORED,
        );
        transfer_rec.pipeline_barrier(&[], &[], &[pre_barrier]);
        transfer_rec.copy_buffer_to_image(&staging, image);

        let post_barrier = sync::image_memory_barrier(
            image,
            PipelineStageFlags2::TRANSFER,
            AccessFlags2::TRANSFER_WRITE,
            PipelineStageFlags2::BOTTOM_OF_PIPE,
            AccessFlags2::NONE,
            ImageAspectFlags::COLOR,
            ImageLayout::TRANSFER_DST_OPTIMAL,
            ImageLayout::SHADER_READ_ONLY_OPTIMAL,
            self.transfer_queue.family.index,
            self.graphics_queue.family.index,
        );
        transfer_rec.pipeline_barrier(&[], &[], &[post_barrier]);

        let post_barrier = sync::image_memory_barrier(
            image,
            PipelineStageFlags2::TOP_OF_PIPE,
            AccessFlags2::NONE,
            PipelineStageFlags2::FRAGMENT_SHADER,
            AccessFlags2::SHADER_READ,
            ImageAspectFlags::COLOR,
            ImageLayout::TRANSFER_DST_OPTIMAL,
            ImageLayout::SHADER_READ_ONLY_OPTIMAL,
            self.transfer_queue.family.index,
            self.graphics_queue.family.index,
        );

        let graphics_rec = &self.graphics_cmds[self.frame % self.retention].record(&self.device);
        graphics_rec.pipeline_barrier(&[], &[], &[post_barrier]);
        self.enqueued += 1;
    }

    pub fn enqueue_buffer<T: Pod>(&mut self, buffer: &TypedBuffer<T>, data: &[T]) {
        log::trace!("Enqueuing upload for {:?}", buffer);

        let size = data.len() as u64 * std::mem::size_of::<T>() as u64;
        let data = bytemuck::cast_slice(data);

        let transfer_rec = &self.transfer_cmds[self.frame % self.retention].record(&self.device);
        let graphics_rec = &self.graphics_cmds[self.frame % self.retention].record(&self.device);

        let staging = self.next_staging_buffer(size);
        staging.write(data);

        let precopy_barrier = sync::buffer_barrier(
            buffer,
            PipelineStageFlags2::COPY,
            AccessFlags2::TRANSFER_WRITE,
            PipelineStageFlags2::ALL_COMMANDS,
            AccessFlags2::NONE,
            self.transfer_queue.family.index,
            self.graphics_queue.family.index,
        );
        transfer_rec.pipeline_barrier(&[], &[precopy_barrier], &[]);
        transfer_rec.copy_buffer(&*staging, &*buffer, size);
        let postcopy_barrier = sync::buffer_barrier(
            buffer,
            PipelineStageFlags2::ALL_COMMANDS,
            AccessFlags2::NONE,
            PipelineStageFlags2::FRAGMENT_SHADER,
            AccessFlags2::SHADER_READ,
            self.transfer_queue.family.index,
            self.graphics_queue.family.index,
        );
        graphics_rec.pipeline_barrier(&[], &[postcopy_barrier], &[]);
        self.enqueued += 1;
    }

    pub fn submit(&mut self) {
        if self.enqueued > 0 {
            let cmd = &mut self.transfer_cmds[self.frame % self.retention];
            let fence = self.transfer_fences[self.frame % self.retention];
            self.device.queue_submit2(&self.transfer_queue, cmd, fence);
            self.device.wait_for_fences(&[fence]);
            cmd.reset();

            let cmd = &mut self.graphics_cmds[self.frame % self.retention];
            let fence = self.gfx_fences[self.frame % self.retention];
            self.device.queue_submit2(&self.graphics_queue, cmd, fence);
            self.device.wait_for_fences(&[fence]);
            cmd.reset();
        }

        let retained = {
            let mut pool = self.buffer_pool.borrow_mut();

            let mut retained = pool
                .extract_if(0.., |b| b.expires > self.frame)
                .collect::<Vec<_>>();

            let remaining = self.pool_size.saturating_sub(retained.len());
            retained.extend(
                pool.extract_if(0.., |b| b.size() > self.retained_size)
                    .take(remaining)
                    .collect::<Vec<_>>(),
            );

            let remaining = self
                .pool_size
                .saturating_sub(retained.len())
                .min(pool.len());
            retained.extend(pool.drain(..remaining).collect::<Vec<_>>());
            retained
        };

        self.buffer_pool.replace(retained);
        self.frame += 1;

        let transfer_cmd = &self.transfer_cmds[self.frame % self.retention];
        let graphics_cmd = &self.graphics_cmds[self.frame % self.retention];
        transfer_cmd.reset();
        graphics_cmd.reset();

        // let transfer_fence = self.transfer_fences[self.frame % self.retention];
        // let graphics_fence = self.gfx_fences[self.frame % self.retention];
        // let fences = [transfer_fence, graphics_fence];

        // self.device.wait_for_fences(&fences);
        // self.device.reset_fences(&fences);
    }
}

#[cfg(test)]
mod tests {
    use {
        super::*,
        crate::{texture::TextureInfo2, Extent2D, Format, Gpu, ImageUsageFlags, Texture},
        ash::vk::ImageAspectFlags,
        std::sync::LazyLock,
    };

    static TEST_GPU: LazyLock<Gpu> =
        LazyLock::new(|| Gpu::headless().expect("Error creating test GPU"));

    fn create_uploader(
        gpu: &Gpu,
        pool_size: usize,
        retention: usize,
        retained_size: u64,
    ) -> Uploader {
        Uploader::new(gpu, pool_size, retention, retained_size)
            .expect("Error creating test uploader")
    }

    fn create_texture(gpu: &Gpu) -> Texture {
        Texture::new2(
            &gpu,
            &TextureInfo2 {
                name: "texture".to_string(),
                format: Format::R8G8B8A8_SRGB,
                extent: Extent2D {
                    width: 1,
                    height: 1,
                },
                flags: ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
                sampler: None,
                aspect_flags: ImageAspectFlags::COLOR,
            },
        )
        .expect("Error creating test texture")
    }

    fn create_buffer(gpu: &Gpu) -> TypedBuffer<u8> {
        TypedBuffer::<u8>::new(
            &gpu.device,
            &gpu.allocator,
            4,
            BufferUsageFlags::TRANSFER_DST,
            MemoryLocation::GpuOnly,
            "test",
        )
        .expect("Error creating test buffer")
    }

    #[test]
    fn test_multiple_submits() {
        let gpu = &*TEST_GPU;
        let texture = create_texture(&gpu);
        let data = vec![255u8; 4];
        let mut uploader = create_uploader(&gpu, 2, 1, 512);

        uploader.submit();
        uploader.submit();
        uploader.submit();
        uploader.submit();
        uploader.submit();
        uploader.submit();
        uploader.enqueue_image(&texture, &data);
        assert_eq!(uploader.buffer_pool.borrow().len(), 1);
    }

    #[test]
    fn test_multiple_enqueues() {
        let gpu = &*TEST_GPU;
        let texture = create_texture(&gpu);
        let buffer = create_buffer(&gpu);
        let data = vec![255u8; 4];
        let mut uploader = create_uploader(&gpu, 2, 1, 512);

        uploader.enqueue_image(&texture, &data);
        uploader.enqueue_buffer(&buffer, &data);
        uploader.enqueue_image(&texture, &data);
        uploader.enqueue_buffer(&buffer, &data);
        uploader.enqueue_image(&texture, &data);
        uploader.enqueue_buffer(&buffer, &data);
        uploader.submit();
        assert_eq!(uploader.buffer_pool.borrow().len(), 6);
    }

    #[test]
    fn test_upload_images() {
        let gpu = &*TEST_GPU;
        let mut uploader = create_uploader(&gpu, 2, 1, 512);
        let data = vec![255u8; 4];
        let texture = create_texture(&gpu);

        assert_eq!(uploader.buffer_pool.borrow().len(), 0);
        uploader.enqueue_image(&texture, &data);
        uploader.submit();
        // assert_eq!(uploader.transfer_cmds[0].cmd_buffer_infos.len(), 0);
        // assert_eq!(uploader.graphics_cmds[0].cmd_buffer_infos.len(), 0);
        uploader.submit();
        uploader.submit();
        assert_eq!(uploader.buffer_pool.borrow().len(), 1);
    }

    #[test]
    fn test_upload_buffer() {
        let gpu = &*TEST_GPU;
        let mut uploader = create_uploader(&gpu, 2, 1, 512);
        let data = vec![255u8; 4];
        let buffer = create_buffer(&gpu);

        assert_eq!(uploader.buffer_pool.borrow().len(), 0);
        uploader.enqueue_buffer(&buffer, &data);
        uploader.submit();
        // assert_eq!(uploader.transfer_cmds[0].cmd_buffer_infos.len(), 0);
        // assert_eq!(uploader.graphics_cmds[0].cmd_buffer_infos.w().len(), 0);
        uploader.submit();
        assert_eq!(uploader.buffer_pool.borrow().len(), 1);
    }

    #[test]
    fn test_upload_exceeds_pool_size() {
        let gpu = &*TEST_GPU;
        let mut uploader = create_uploader(&gpu, 2, 1, 512);
        let data = vec![255u8; 4];
        let buffer = create_buffer(&gpu);

        uploader.enqueue_buffer(&buffer, &data);
        uploader.enqueue_buffer(&buffer, &data);
        uploader.enqueue_buffer(&buffer, &data);
        assert_eq!(uploader.buffer_pool.borrow().len(), 3);
        uploader.submit();
        uploader.submit();
        uploader.submit();
        uploader.submit();
        uploader.submit();
        assert_eq!(uploader.buffer_pool.borrow().len(), 2);
    }

    #[test]
    fn test_upload_size_exceeds_buffer_size() -> Result<()> {
        let gpu = &*TEST_GPU;
        let mut uploader = Uploader::new(&gpu, 2, 1, 512)?;
        let size = 1024;
        let data = vec![255u8; size];
        let texture = create_texture(&gpu);

        uploader.enqueue_image(&texture, &data);
        assert_eq!(uploader.buffer_pool.borrow()[0].size(), size as u64);
        uploader.submit();
        uploader.submit();
        uploader.submit();
        assert_eq!(uploader.buffer_pool.borrow().len(), 1);
        assert_eq!(uploader.buffer_pool.borrow()[0].size(), size as u64);

        Ok(())
    }
}
