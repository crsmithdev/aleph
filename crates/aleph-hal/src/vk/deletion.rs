use std::{cell::UnsafeCell, collections::HashMap, sync::Arc};
use crate::{Buffer, DeviceAddress};

use ash::vk;
use derive_more::Debug;
use gpu_allocator as ga;

use super::Allocator;

pub enum Deletion {
    Buffer((vk::Buffer, ga::vulkan::Allocation)),
}

pub trait D {
    fn drop(&mut self);
}
#[derive(Debug)]
pub struct DeletionQueue {
    #[debug("{:?}", pending.len())]
    pub pending: HashMap<usize, Vec<Deletion>>,
    // allocator: Arc<Allocator>,
    current_frame: usize,
    n_frames: usize,
}

impl DeletionQueue {
    pub fn new(frames_in_flight: u32) -> Self {
        let mut pending = HashMap::new();
        for i in 0..frames_in_flight as usize {
            pending.insert(i, vec![]);
        }
        Self {
            pending,
            // allocator,
            current_frame: 0,
            n_frames: frames_in_flight as usize,
        }
    }
}

impl DeletionQueue {
    pub fn flush(mut self) {
        let queue = &self.pending[&self.current_frame];
        self.current_frame = (self.current_frame + 1) % self.n_frames;

        // for item in queue.drain(..) {
        //     match item {
        //         Deletion::Buffer((buffer, allocation)) => {
        //             unsafe {
        //                 // self.allocator.device.handle.destroy_buffer(buffer, None);
        //                 // self.allocator.inner.lock().unwrap().free(allocation).unwrap();
        //             }
        //         }
        //     }
        // }
    }

    pub fn destroy_buffer(mut self, buffer: Buffer) {
        // let deletion = Deletion::Buffer((buffer.handle, buffer.allocation));
        // let frame = (self.current_frame + self.n_frames) & self.n_frames;
        // let queue = &self.pending[&frame];
        // queue.push(deletion);
        // self.pending.push(deletion)://
        // self.pending.push(Box::new(move || {
            // self.allocator.inner.lock().unwrap().free(buffer.allocation).unwrap();
            // unsafe {
                // self.allocator.device.destroy_buffer(buffer.handle, None);
            // }
        // }));
    }
}

