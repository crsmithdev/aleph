use {
    derive_more::Debug,
    std::any::Any,
};

#[derive(Default, Debug)]
pub struct DeletionQueue {
    #[debug("{:?}", pending.len())]
    pub pending: Vec<Box<dyn Any>>,
}

impl DeletionQueue {
    pub fn flush(&mut self) {
        for object in self.pending.drain(..) {
            drop(object);
        }
    }

    pub fn enqueue<T: Any>(&mut self, object: T) {
        self.pending.push(Box::new(object));
    }
}