use {
    ash::vk,
    derive_more::Debug,
    downcast_rs::{impl_downcast, Downcast},
    gpu_allocator as ga,
};

pub enum Deletion {
    Buffer((vk::Buffer, ga::vulkan::Allocation)),
}

pub trait Destroyable: Downcast + 'static {
    fn destroy(&mut self);
}
impl_downcast!(Destroyable);

#[derive(Default, Debug)]
pub struct DeletionQueue {
    #[debug("{:?}", pending.len())]
    pub pending: Vec<Box<dyn Destroyable>>,
}

impl DeletionQueue {
    pub fn flush(&mut self) {
        for mut object in self.pending.drain(..) {
            log::debug!("Deleting object");
            object.destroy();
        }
    }

    pub fn enqueue<T: Destroyable + 'static>(&mut self, object: T) {
        self.pending.push(Box::new(object));
    }
}

#[derive(Default)]
pub struct DeletionQueue2 {
    pending: Vec<Box<dyn FnOnce() + 'static>>,
}
impl DeletionQueue2 {
    pub fn enqueue(&mut self, callback: impl FnOnce() + 'static) {
        self.pending.push(Box::new(callback));
    }
    pub fn flush(&mut self) {
        for callback in self.pending.drain(..) {
            callback();
        }
    }
}