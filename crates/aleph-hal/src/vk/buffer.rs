use {
    crate::vk::{Allocator, Device}, anyhow::Result, ash::vk::{self, DeviceAddress, Handle}, derive_more::Debug, gpu_allocator::vulkan::Allocation, std::{cell::RefCell, sync::Arc}
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
    info: BufferInfo,
    pub(crate) allocator: Arc<Allocator>,
    pub(crate) allocation: RefCell<Allocation>,
    address: DeviceAddress,
}

impl Buffer {
    pub fn new(allocator: Arc<Allocator>, device: &Device, info: BufferInfo) -> Result<Buffer> {
        let handle = unsafe {
            device.handle.create_buffer(
                &vk::BufferCreateInfo::default()
                    .size(info.size as u64)
                    .usage(info.usage | BufferUsageFlags::SHADER_DEVICE_ADDRESS),
                None,
            )
        }?;

        let requirements = unsafe { device.get_buffer_memory_requirements(handle) };
        let allocation = RefCell::new(allocator.allocate_buffer(handle, requirements, info)?);
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

    #[inline]
    pub fn handle(&self) -> vk::Buffer {
        self.handle
    }

    #[inline]
    pub fn address(&self) -> vk::DeviceAddress {
        self.address
    }

    pub fn write(&self, data: &[u8]) {
        let mut allocation = self.allocation.borrow_mut();
        let slice = allocation.mapped_slice_mut().expect("Failed to map buffer memory");
        slice.copy_from_slice(data);
    }
}

impl Drop for Buffer {
    fn drop(&mut self) {
        log::debug!("Dropping buffer: {:?}", self.info.label);
        let allocation = self.allocation.take();
        self.allocator.deallocate(allocation);
        unsafe { self.device.destroy_buffer(self.handle, None) };
    }
}   
