use {
    crate::{
        sync, AccessFlags2, Allocator, Buffer, BufferUsageFlags, CommandBuffer, Device, Gpu, Image,
        MemoryLocation, PipelineStageFlags2, Queue, TypedBuffer,
    },
    anyhow::Result,
    ash::vk::{
        self, Fence, FenceCreateFlags, ImageAspectFlags, ImageLayout, Semaphore,
        QUEUE_FAMILY_IGNORED,
    },
    bytemuck::Pod,
    derive_more::{derive::Debug, Deref},
    std::{cell::RefCell, rc::Rc, sync::Arc},
    tracing::instrument,
};

struct StagingResource<T> {
    resource: T,
    expires: usize,
}

struct ResourcePool<T> {
    pool: RefCell<Vec<Rc<StagingResource<T>>>>,
    size: usize,
    retention: usize,
    frame: usize,
    create: Box<dyn Fn() -> T + 'static>, // Function to create new resources
}

impl<T> ResourcePool<T> {
    fn new(size: usize, retention: usize, create: impl Fn() -> T + 'static) -> Self {
        Self {
            pool: RefCell::new(Vec::new()),
            size: 0,
            retention: 0,
            frame: 0,
            create: Box::new(create),
        }
    }

    fn next(&mut self, size: usize) -> Rc<StagingResource<T>> {
        let mut pool = self.pool.borrow_mut();
        let found = pool.iter().position(|r| r.expires < self.frame);

        match found {
            Some(index) => {
                let staging = Rc::get_mut(&mut pool[index]).unwrap_or_else(|| {
                    panic!("Failed to get inner resource from Rc");
                });
                staging.expires = self.frame + self.retention;
                Rc::clone(&pool[index])
            }
            None => {
                pool.push(Rc::new(StagingResource {
                    expires: self.frame + self.retention,
                    resource: (self.create)(),
                }));
                Rc::clone(&pool[pool.len() - 1])
            }
        }
    }

    pub fn update(&mut self) {
        let retained = {
            let mut pool = self.pool.borrow_mut();

            let mut retained = pool
                .extract_if(0.., |r| r.expires > self.frame)
                .collect::<Vec<_>>();

            // let remaining = self.pool_size.saturating_sub(retained.len());
            // retained.extend(
            //     pool.extract_if(0.., |r| {
            //         (self.get_size)(&r.resource) > self.retained_size as u64
            //     })
            //     .take(remaining)
            //     .collect::<Vec<_>>(),
            // );

            let remaining = self.size.saturating_sub(retained.len()).min(pool.len());
            retained.extend(pool.drain(..remaining).collect::<Vec<_>>());
            retained
        };

        self.pool.replace(retained);
        self.frame += 1;
    }
}

#[cfg(test)]
mod tests {
    use {
        super::*,
        crate::Gpu,
        ash::vk::{BufferUsageFlags, MemoryPropertyFlags},
        std::sync::LazyLock,
    };

    static TEST_GPU: LazyLock<Gpu> =
        LazyLock::new(|| Gpu::headless().expect("Error creating test GPU"));

    #[test]
    fn test_resource_pool() {
        let gpu = &*TEST_GPU;

        let mut pool: ResourcePool<Buffer> = ResourcePool::new(10, 2, move || {
            Buffer::new(
                &gpu.device,
                &gpu.allocator,
                1024 as u64,
                BufferUsageFlags::STORAGE_BUFFER,
                MemoryLocation::CpuToGpu,
                "test",
            )
            .unwrap()
        });

        for i in 0..20 {
            let resource = pool.next(i);
            assert_eq!(resource.expires, i + pool.retention);
            assert_eq!(pool.pool.borrow().len(), 1);
        }

        pool.update();
        assert_eq!(pool.pool.borrow().len(), 1);

        for i in 0..10 {
            pool.update();
            assert_eq!(pool.pool.borrow().len(), 1);
        }
    }
}
