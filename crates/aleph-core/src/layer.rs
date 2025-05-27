use crate::{Resources, Scheduler};

pub trait Layer: 'static {
    fn register(&mut self, scheduler: &mut Scheduler, resources: &mut Resources);
}
