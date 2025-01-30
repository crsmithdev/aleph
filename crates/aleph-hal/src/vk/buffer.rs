use {
    crate::vk::{Allocator, Gpu, Device}, anyhow::Result, ash::vk::{self, DeviceAddress, Handle}, derive_more::Debug, gpu_allocator::vulkan::Allocation, std::sync::Arc
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
    pub(crate) info: BufferInfo,
    pub(crate) allocator: Arc<Allocator>,
    address: DeviceAddress,
}

impl Buffer {
    pub fn new2(gpu: &Gpu, info: BufferInfo) -> Result<Self> {
        let handle = unsafe {
            gpu.device.handle.create_buffer(
                &vk::BufferCreateInfo::default()
                    .size(info.size as u64)
                    .usage(info.usage | BufferUsageFlags::SHADER_DEVICE_ADDRESS),
                None,
            )
        }?;

        let allocation = gpu.allocator.allocate_buffer(handle, info)?;

        Ok(Buffer {
            handle,
            allocation,
            info,
            device: gpu.device.clone(),
            allocator: gpu.allocator.clone(),
            address: gpu.device.get_buffer_device_address(&handle),
        })
    }
    pub fn new(allocator: Arc<Allocator>,  device: &Device, info: BufferInfo) -> Result<Buffer> {
        let handle = unsafe {
            device.handle.create_buffer(
                &vk::BufferCreateInfo::default()
                    .size(info.size as u64)
                    .usage(info.usage | BufferUsageFlags::SHADER_DEVICE_ADDRESS),
                None,
            )
        }?;

        let allocation = allocator.allocate_buffer(handle, info)?;
        // let device: &crate::Device = &allocator.device;
        let address = device.get_buffer_device_address(&handle);

        Ok(Buffer {
            handle,
            device: device.clone(),
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
}

impl crate::vk::deletion::Destroyable for Buffer {
    fn destroy(&mut self) {
        log::debug!("Destroying buffer: {:?}", self.info.label);
        self.allocator.destroy_buffer(self.handle, &mut self.allocation);
    }
}
