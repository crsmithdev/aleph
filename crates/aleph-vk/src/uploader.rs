use {
    crate::{
        sync, AccessFlags2, Allocator, Buffer, BufferUsageFlags, CommandBuffer, Device, Gpu, Image,
        MemoryLocation, PipelineStageFlags2, Queue, TypedBuffer,
    },
    anyhow::Result,
    ash::vk::{ImageAspectFlags, ImageLayout, QUEUE_FAMILY_IGNORED},
    bytemuck::Pod,
    derive_more::{derive::Debug, Deref},
    std::{cell::RefCell, collections, rc::Rc, sync::Arc},
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
    transfer_queue: Queue,
    graphics_queue: Queue,
    enqueued: usize,
    frame: usize,
}

impl Uploader {
    pub fn new(gpu: &Gpu, pool_size: usize, retention: usize, retained_size: u64) -> Result<Self> {
        let allocator = Arc::clone(&gpu.allocator());
        let device = gpu.device().clone();

        let transfer_pool = device.create_command_pool(&gpu.device.transfer_queue)?;
        let graphics_pool = device.create_command_pool(&gpu.device.graphics_queue)?;
        let transfer_cmds = (0..pool_size)
            .map(|_| transfer_pool.create_command_buffer())
            .collect::<Vec<_>>();
        let graphics_cmds = (0..pool_size)
            .map(|_| graphics_pool.create_command_buffer())
            .collect::<Vec<_>>();
        let transfer_queue = gpu.device.transfer_queue;
        let graphics_queue = gpu.device.graphics_queue;

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
            pool_size,
            retained_size,
            retention,
        };

        Ok(uploader)
    }

    fn transfer_cmd(&self) -> &CommandBuffer { &self.transfer_cmds[self.frame % self.retention] }

    fn graphics_cmd(&self) -> &CommandBuffer { &self.graphics_cmds[self.frame % self.retention] }

    fn next_staging_index(&self, size: u64) -> Rc<StagingBuffer> {
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
                // pool.len() - 1
            }
        }
    }

    pub fn enqueue_image(&mut self, image: &Image, data: &[u8]) {
        log::debug!("Enqueueing upload for ({:?})", image);

        let size = data.len() as u64;
        let transfer_cmd = self.transfer_cmd();
        let transfer_rec = transfer_cmd.record(&self.device);
        let graphics_cmd = self.graphics_cmd();
        let graphics_rec = graphics_cmd.record(&self.device);

        let staging = self.next_staging_index(size);
        staging.write(data);

        let precopy_barrier = sync::image_barrier(
            image,
            PipelineStageFlags2::TRANSFER,
            AccessFlags2::MEMORY_WRITE,
            PipelineStageFlags2::NONE,
            AccessFlags2::NONE,
            ImageAspectFlags::COLOR,
            ImageLayout::UNDEFINED,
            ImageLayout::TRANSFER_DST_OPTIMAL,
            QUEUE_FAMILY_IGNORED,
            QUEUE_FAMILY_IGNORED,
        );
        transfer_rec.pipeline_barrier(&[], &[], &[precopy_barrier]);
        transfer_rec.copy_buffer_to_image(&staging, image);

        let postcopy_barrier = sync::image_barrier(
            image,
            PipelineStageFlags2::TRANSFER,
            AccessFlags2::TRANSFER_WRITE,
            PipelineStageFlags2::NONE,
            AccessFlags2::NONE,
            ImageAspectFlags::COLOR,
            ImageLayout::TRANSFER_DST_OPTIMAL,
            ImageLayout::SHADER_READ_ONLY_OPTIMAL,
            transfer_cmd.queue().family.index,
            graphics_cmd.queue().family.index,
        );
        transfer_rec.pipeline_barrier(&[], &[], &[postcopy_barrier]);

        let handoff_barrier = sync::image_barrier(
            image,
            PipelineStageFlags2::NONE,
            AccessFlags2::NONE,
            PipelineStageFlags2::FRAGMENT_SHADER,
            AccessFlags2::SHADER_READ,
            ImageAspectFlags::COLOR,
            ImageLayout::TRANSFER_DST_OPTIMAL,
            ImageLayout::SHADER_READ_ONLY_OPTIMAL,
            transfer_cmd.queue().family.index,
            graphics_cmd.queue().family.index,
        );
        graphics_rec.pipeline_barrier(&[], &[], &[handoff_barrier]);
    }

    pub fn enqueue_buffer<T: Pod>(&mut self, buffer: &TypedBuffer<T>, data: &[T]) {
        log::trace!("Enqueuing upload for {:?}", buffer);
        self.enqueued += 1;

        let size = data.len() as u64 * std::mem::size_of::<T>() as u64;
        let data = bytemuck::cast_slice(data);

        let transfer_rec = self.transfer_cmd().record(&self.device);
        let graphics_rec = self.graphics_cmd().record(&self.device);

        let staging = self.next_staging_index(size);
        staging.write(data);

        let precopy_barrier = sync::buffer_barrier(
            buffer,
            PipelineStageFlags2::TRANSFER,
            PipelineStageFlags2::ALL_COMMANDS,
            AccessFlags2::TRANSFER_WRITE,
            AccessFlags2::NONE,
            self.transfer_queue.family.index,
            self.graphics_queue.family.index,
        );
        transfer_rec.pipeline_barrier(&[], &[precopy_barrier], &[]);
        transfer_rec.copy_buffer(&*staging, &*buffer, size);

        let postcopy_barrier = sync::buffer_barrier(
            buffer,
            PipelineStageFlags2::ALL_COMMANDS,
            PipelineStageFlags2::ALL_GRAPHICS,
            AccessFlags2::NONE,
            AccessFlags2::SHADER_READ,
            self.transfer_queue.family.index,
            self.graphics_queue.family.index,
        );
        graphics_rec.pipeline_barrier(&[], &[postcopy_barrier], &[]);
    }

    pub fn submit(&mut self) {
        let transfer_cmd = &self.transfer_cmd();
        let graphics_cmd = &self.graphics_cmd();
        self.device.queue_submit(&transfer_cmd);
        self.device.queue_submit(&graphics_cmd);

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

        let transfer_cmd = self.transfer_cmd();
        let graphics_cmd = self.graphics_cmd();

        let fences = [transfer_cmd.fence, graphics_cmd.fence]
            .into_iter()
            .filter_map(|f| f)
            .collect::<Vec<_>>();
        self.device.wait_for_fences(&fences);
        self.device.reset_fences(&fences);
    }
}

#[cfg(test)]
mod tests {
    use {
        super::*,
        crate::{texture::TextureInfo2, Extent2D, Format, Gpu, ImageUsageFlags, Texture},
        ash::vk::ImageAspectFlags,
    };

    fn test_gpu() -> Gpu { Gpu::headless().expect("Error creating test GPU") }

    fn test_uploader(
        gpu: &Gpu,
        pool_size: usize,
        retention: usize,
        retained_size: u64,
    ) -> Uploader {
        Uploader::new(gpu, pool_size, retention, retained_size)
            .expect("Error creating test uploader")
    }

    fn test_texture(gpu: &Gpu) -> Texture {
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

    fn test_buffer(gpu: &Gpu) -> TypedBuffer<u8> {
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
    fn test_upload_images() {
        let gpu = test_gpu();
        let mut uploader = test_uploader(&gpu, 2, 1, 512);
        let data = vec![255u8; 4];
        let texture = test_texture(&gpu);

        assert_eq!(uploader.buffer_pool.borrow().len(), 0);
        uploader.enqueue_image(&texture, &data);
        uploader.submit();
        uploader.submit();
        uploader.submit();
        assert_eq!(uploader.buffer_pool.borrow().len(), 1);
    }

    #[test]
    fn test_upload_buffer() {
        let gpu = test_gpu();
        let mut uploader = test_uploader(&gpu, 2, 1, 512);
        let data = vec![255u8; 4];
        let buffer = test_buffer(&gpu);

        assert_eq!(uploader.buffer_pool.borrow().len(), 0);
        uploader.enqueue_buffer(&buffer, &data);
        uploader.submit();
        uploader.submit();
        assert_eq!(uploader.buffer_pool.borrow().len(), 1);
    }

    #[test]
    fn test_upload_exceeds_pool_size() {
        let gpu = test_gpu();
        let mut uploader = test_uploader(&gpu, 2, 1, 512);
        let data = vec![255u8; 4];
        let buffer = test_buffer(&gpu);

        uploader.enqueue_buffer(&buffer, &data);
        uploader.enqueue_buffer(&buffer, &data);
        uploader.enqueue_buffer(&buffer, &data);
        assert_eq!(uploader.buffer_pool.borrow().len(), 3);
        uploader.submit();
        uploader.submit();
        uploader.submit();
        assert_eq!(uploader.buffer_pool.borrow().len(), 2);
    }

    #[test]
    fn test_upload_size_exceeds_buffer_size() -> Result<()> {
        let gpu = Gpu::headless()?;
        let mut uploader = Uploader::new(&gpu, 2, 1, 512)?;
        let size = 1024;
        let data = vec![255u8; size];
        let texture = test_texture(&gpu);

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
