use {
    ash::vk,
    derive_more::Debug,
    gpu_allocator as ga,
};

pub enum Deletion {
    Buffer((vk::Buffer, ga::vulkan::Allocation)),
}

pub trait Destroyable {
    fn destroy(&mut self);
}

#[derive(Default, Debug)]
pub struct DeletionQueue {
    #[debug("{:?}", pending.len())]
    pub pending: Vec<Box<dyn Destroyable>>,
}

impl DeletionQueue {
    pub fn flush(&mut self) {
        // log::debug!("flushing deletion queue (len: {})", self.pending.len());
        for mut object in self.pending.drain(..) {
            log::debug!("Deleting object");
            object.destroy();
        }
    }

    pub fn enqueue<T: Destroyable + 'static>(&mut self, object: T) {
        self.pending.push(Box::new(object));
    }
}
