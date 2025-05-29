use {
    crate::{Buffer, Gpu},
    anyhow::Result,
    ash::vk::BufferUsageFlags,
    derive_more::derive::Debug,
    gpu_allocator::MemoryLocation,
    std::{
        cell::RefCell,
        collections::VecDeque,
        rc::Rc,
        sync::{Arc, Mutex},
    },
};

pub trait Poolable {
    fn new(gpu: &Gpu) -> Self;
    fn reset(&mut self, gpu: &Gpu);
}

#[derive(Clone, Debug)]
struct Pooled<T>
where
    T: Poolable,
{
    resource: Rc<T>,
    expires: usize,
}

#[derive(Debug)]
pub struct ResourcePool<T>
where
    T: Poolable,
{
    gpu: Arc<Gpu>,
    pool: RefCell<Vec<Pooled<T>>>,
    size: usize,
    retention: usize,
    frame: usize,
}

impl<T> ResourcePool<T>
where
    T: Poolable,
{
    pub fn new(gpu: &Arc<Gpu>, size: usize, retention: usize) -> Self {
        Self {
            gpu: Arc::clone(&gpu),
            pool: RefCell::new(Vec::new()),
            size: size,
            retention: retention,
            frame: 0,
        }
    }

    pub fn next(&self) -> Rc<T> {
        let index = self.pool.borrow().iter().position(|r| r.expires < self.frame);

        match index {
            Some(index) => {
                let pooled = &self.pool.borrow()[index];
                let rc = pooled.resource.clone();
                rc
            }
            None => {
                let new = T::new(&self.gpu);
                let mut pool = self.pool.borrow_mut();
                pool.push(Pooled {
                    resource: Rc::new(new),
                    expires: self.frame + self.retention,
                });
                Rc::clone(&pool[pool.len() - 1].resource)
            }
        }
    }

    pub fn update(&mut self) {
        let retained = {
            let mut pool = self.pool.borrow_mut();

            let mut retained = pool.extract_if(0.., |r| r.expires > self.frame).collect::<Vec<_>>();

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

impl Poolable for Buffer {
    fn new(gpu: &Gpu) -> Self {
        Buffer::new(
            &gpu.device(),
            &gpu.allocator(),
            1024 * 1024 * 10,
            BufferUsageFlags::TRANSFER_SRC,
            MemoryLocation::CpuToGpu,
            "staging",
        )
        .unwrap_or_else(|e| {
            panic!("Failed to create staging buffer: {:?}", e);
        })
    }

    fn reset(&mut self, _gpu: &Gpu) {}
}
#[cfg(test)]
mod tests {
    use {super::*, crate::test::test_gpu};
    #[test]
    #[cfg(feature = "gpu-tests")]
    fn test_resource_pool() {
        let gpu = test_gpu();
        let mut pool = ResourcePool::<Buffer>::new(&gpu, 10, 5);

        let _ = pool.next();
        assert_eq!(pool.pool.borrow().len(), 1);

        pool.update();
    }
}
