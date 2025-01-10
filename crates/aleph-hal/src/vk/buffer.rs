pub use gpu_allocator::MemoryLocation;
use {
    crate::vk::{CommandBuffer, Device, MemoryAllocator},
    anyhow::Result,
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

    pub fn upload_data<T: serde::Serialize>(
        &mut self,
        _cmd: CommandBuffer,
        _data: &T,
    ) -> Result<()> {
        // let bytes = bincode::serialize(data)?;
        // let size = bytes.len();

        // let staging = Buffer::new(
        //     &self.allocator.device,
        //     self.allocator.clone(),
        //     BufferInfo {
        //         usage: vk::BufferUsageFlags::TRANSFER_SRC,
        //         location: MemoryLocation::CpuToGpu,
        //         size,
        //     },
        // )?;

        // let slice = self
        //     .allocation
        //     .mapped_slice_mut()
        //     .ok_or_else(|| anyhow::anyhow!("Buffer upload memory map failed"))?;
        // slice[0..bytes.len()].copy_from_slice(&bytes);

        // let copy = vk::BufferCopy::default().size(size as u64);
        // cmd.submit_immediate(|_| unsafe {
        //     self.allocator.device.inner.cmd_copy_buffer(
        //         cmd.inner,
        //         staging.handle,
        //         self.handle,
        //         &[copy],
        //     );
        // })?;

        Ok(())
    }
}
