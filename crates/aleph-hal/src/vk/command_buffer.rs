use {
    ash::{vk, vk::Handle},
    std::fmt,
};

pub struct CommandBuffer {
    pub inner: vk::CommandBuffer,
}

impl fmt::Debug for CommandBuffer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CommandBuffer")
            .field("inner", &format_args!("{:x}", &self.inner.as_raw()))
            .finish_non_exhaustive()
    }
}
