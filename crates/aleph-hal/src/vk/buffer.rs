pub use gpu_allocator::MemoryLocation;
use {
    crate::vk::{CommandBuffer, Device, MemoryAllocator},
    anyhow::{Result},
    ash::{vk, vk::Handle},
    derive_more,
    gpu_allocator::vulkan::Allocation,
    serde,
    std::sync::Arc,
};

#[derive(Debug, Clone, Copy)]
pub struct BufferInfo {
    pub size: usize,
    pub usage: vk::BufferUsageFlags,
    pub location: gpu_allocator::MemoryLocation,
}

#[allow(dead_code)]
#[derive(derive_more::Debug)]
pub struct Buffer {
    #[debug("{:x}", handle.as_raw())]
    pub(crate) handle: vk::Buffer,
    allocation: Allocation,
    info: BufferInfo,
    allocator: Arc<MemoryAllocator>,
}

impl Buffer {
    pub fn new(
        device: &Device,
        allocator: Arc<MemoryAllocator>,
        info: BufferInfo,
    ) -> Result<Buffer> {
        let buffer = unsafe {
            device.handle.create_buffer(
                &vk::BufferCreateInfo::default()
                    .size(info.size as u64)
                    .usage(info.usage),
                None,
            )
        }?;

        let allocation = allocator.allocate_buffer(buffer, info)?;

        Ok(Buffer {
            handle: buffer,
            allocation,
            info,
            allocator,
        })
    }

    pub fn handle(&self) -> vk::Buffer {
        self.handle
    }

    pub fn upload_data<T: serde::Serialize>(&self, cmd: &CommandBuffer, data: &T) -> Result<()> {
        let bytes = bincode::serialize(data)?;
        let size = bytes.len();

        let mut staging = Buffer::new(
            &self.allocator.device,
            self.allocator.clone(),
            BufferInfo {
                usage: vk::BufferUsageFlags::TRANSFER_SRC,
                location: MemoryLocation::CpuToGpu,
                size,
            },
        )?;

        let slice = staging
            .allocation
            .mapped_slice_mut()
            .ok_or_else(|| anyhow::anyhow!("Could not map staging buffer memory"))?;
        slice[0..bytes.len()].copy_from_slice(&bytes);

        cmd.submit_immediate(|_| {
            let copy = vk::BufferCopy::default().size(size as u64);
            unsafe {
                self.allocator.device.handle.cmd_copy_buffer(
                    cmd.handle(),
                    staging.handle(),
                    self.handle(),
                    &[copy],
                )
            };
        })?;
        Ok(())
    }
}
