use {
    crate::vk::{Allocator, CommandBuffer, Device},
    anyhow::Result,
    ash::vk::{self, DeviceAddress, Handle},
    bytemuck::Pod,
    derive_more::Debug,
    gpu_allocator::vulkan::Allocation,
    serde::Serialize,
    std::sync::Arc,
};
pub use {gpu_allocator::MemoryLocation, vk::BufferUsageFlags};

#[derive(Debug, Clone, Copy)]
pub struct BufferInfo {
    pub size: usize,
    pub usage: BufferUsageFlags,
    pub location: MemoryLocation,
    pub label: Option<&'static str>,
}

#[allow(dead_code)]
#[derive(Debug)]
pub struct Buffer {
    #[debug("{:x}", handle.as_raw())]
    pub(crate) handle: vk::Buffer,
    device: Device,
    pub(crate) allocation: Allocation,
    info: BufferInfo,
    allocator: Arc<Allocator>,
    address: DeviceAddress,
}

impl Buffer {
    pub fn new(allocator: Arc<Allocator>, info: BufferInfo) -> Result<Buffer> {
        let handle = unsafe {
            allocator.device.handle.create_buffer(
                &vk::BufferCreateInfo::default()
                    .size(info.size as u64)
                    .usage(info.usage),
                None,
            )
        }?;

        let allocation = allocator.allocate_buffer(handle, info)?;
        let device: &crate::Device = &allocator.device;
        let address = device.get_buffer_device_address(&handle);

        Ok(Buffer {
            handle,
            device: allocator.device.clone(),
            allocation,
            info,
            allocator,
            address,
        })
    }

    pub fn handle(&self) -> vk::Buffer {
        self.handle
    }

    pub fn device_address(&self) -> vk::DeviceAddress {
        self.address
    }

    pub fn mapped(&mut self) -> &mut [u8] {
        self.allocation
            .mapped_slice_mut()
            .expect("Failed to map buffer memory")
    }

    pub fn upload<T: Serialize + Pod>(&self, cmd: &CommandBuffer, data: &[T]) -> Result<()> {
        let data: &[u8] = bytemuck::cast_slice(data);
        let size = data.len();

        let mut staging: crate::Buffer = Buffer::new(
            self.allocator.clone(),
            BufferInfo {
                usage: BufferUsageFlags::TRANSFER_SRC,
                location: MemoryLocation::CpuToGpu,
                size,
                label: Some("staging")
            },
        )?;

        staging.mapped()[0..data.len()].copy_from_slice(data);
        cmd.submit_immediate(|_| {
            cmd.copy_buffer(&staging, self, size as u64);
        })?;

        // staging.destroy();
        Ok(())
    }

    pub fn destroy(self, deletion_queue: &mut crate::DeletionQueue) {
        // self.allocator.inner.lock().unwrap().free(self.allocation).unwrap();
        // unsafe {
        //     self.device.destroy_buffer(self.handle, None);
        // }
        // let allocation = std::mem::take(&mut self.allocation);
        // deletion_queue.pending.push(Box::new(move || {
        //     self.allocator.inner.lock().unwrap().free(self.allocation).unwrap();
        //     unsafe {
        //         self.allocator.device.destroy_buffer(self.handle, None);
        //     }
        // }));
    }
}
