use {
    crate::vk::{Allocator,  CommandBuffer, Device}, anyhow::Result, ash::vk::{self, DeviceAddress, Handle}, derive_more::Debug, gpu_allocator::vulkan::Allocation, std::{cell::RefCell, process::Command, slice, sync::Arc}
};
pub use {gpu_allocator::MemoryLocation, vk::BufferUsageFlags};

#[derive(Debug, Clone, Copy)]
pub struct BufferInfo {
    pub size: usize,
    pub usage: BufferUsageFlags,
    pub location: MemoryLocation,
    pub label: Option<&'static str>,
}

pub struct BufferInfo2 {
    pub size: usize,
    pub usage: BufferUsageFlags,
    pub label: Option<&'static str>,
}

pub struct GpuBuffer {
    inner: Buffer,
}
impl GpuBuffer {
    pub fn new(allocator: Arc<Allocator>, device: &Device, info: BufferInfo) -> Result<Self> {
        Ok(Self {
            inner: Buffer::new(allocator, device, info)?,
        })
    }
    pub fn write(&self, data: &[u8], cmd: &CommandBuffer) {
        let _ = cmd;
        self.inner.write(data);
    }

    pub fn size(&self) -> usize {
        self.inner.size()
    }

    pub fn label(&self) -> &'static str{
        self.inner.info.label.unwrap_or("unnamed")
    }

}



#[allow(dead_code)]
#[derive(Debug)]
pub struct Buffer {
    #[debug("{:x}", handle.as_raw())]
    pub(crate) handle: vk::Buffer,
    device: Device,
    pub info: BufferInfo,
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

        let requirements = unsafe { device.handle.get_buffer_memory_requirements(handle) };
        let allocation = RefCell::new(allocator.allocate_buffer(handle, requirements, info)?);
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

    pub fn size(&self) -> usize {
        self.info.size
    }

    #[inline]
    pub fn address(&self) -> vk::DeviceAddress {
        self.address
    }
    
    pub fn write2<T: bytemuck::Pod>(&self, data: &[T]) {
        let mut allocation = self.allocation.borrow_mut();
        let mapped = allocation.mapped_slice_mut().expect("Failed to map buffer memory");
        let size = std::mem::size_of_val(data);
        let bytes = bytemuck::cast_slice(data);
        
        mapped[0..size].copy_from_slice(bytes);
    }


    pub fn write(&self, data: &[u8]) {
        let mut allocation = self.allocation.borrow_mut();
        let slice = allocation.mapped_slice_mut().expect("Failed to map buffer memory");
        
        slice[0..data.len()].copy_from_slice(data);
    }
}

impl Drop for Buffer {
    fn drop(&mut self) {
        // log::debug!("Dropping buffer: {:?}", self.info.label);
        // let allocation = self.allocation.take();
        // self.allocator.deallocate(allocation);
        // unsafe { self.device.destroy_buffer(self.handle, None) };
    }
}   
