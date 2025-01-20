pub use gpu_allocator::MemoryLocation;
pub use vk::BufferUsageFlags;
use {
    crate::vk::{CommandBuffer, Device, Allocator},
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
    pub usage: BufferUsageFlags,
    pub location: gpu_allocator::MemoryLocation,
}

#[allow(dead_code)]
#[derive(derive_more::Debug)]
pub struct Buffer {
    #[debug("{:x}", handle.as_raw())]
    pub(crate) handle: vk::Buffer,
    allocation: Allocation,
    info: BufferInfo,
    allocator: Arc<Allocator>,
}

impl Buffer {
    pub fn new(
        device: &Device,
        allocator: Arc<Allocator>,
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

    pub fn upload_data<T: serde::Serialize + bytemuck::Pod>(&self, cmd: &CommandBuffer, data: &[T]) -> Result<()> {
        let data: &[u8] = bytemuck::cast_slice(data);
        let t_align =  std::mem::align_of::<T>() as u64;
        let t_size = std::mem::size_of::<T>() as u64;
        let data_len = data.len() as u64;
        let expected_size = data_len * t_size;

        log::debug!("t_align: {:?}", t_align);
        log::debug!("t_size: {:?}", t_size);
        log::debug!("data_len: {:?}", data_len);
        log::debug!("expected_size: {:?}", expected_size);

        let bytes = data;
        let size = bytes.len();
        log::debug!("bincode size: {:?}", size);

        let mut staging = Buffer::new(
            &self.allocator.device,
            self.allocator.clone(),
            BufferInfo {
                usage: BufferUsageFlags::TRANSFER_SRC,
                location: MemoryLocation::CpuToGpu,
                size,
            },
        )?;
        log::debug!("staging buffer info: {:?}", staging.info);

        let slice = staging
            .allocation
            .mapped_slice_mut()
            .ok_or_else(|| anyhow::anyhow!("Could not map staging buffer memory"))?;
        slice[0..bytes.len()].copy_from_slice(&bytes);

        cmd.submit_immediate(|_| {
            let copy = vk::BufferCopy::default().size(size as u64);
            log::debug!("buffer_copy: {:?}", copy);
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
