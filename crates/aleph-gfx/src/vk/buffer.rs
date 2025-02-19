use {
    crate::vk::{Allocator, Device},
    anyhow::{Ok, Result},
    ash::vk::{self, DeviceAddress, Handle},
    bytemuck::Pod,
    derive_more::Debug,
    gpu_allocator::vulkan::Allocation,
    std::{cell::RefCell, mem},
};
pub use {gpu_allocator::MemoryLocation, vk::BufferUsageFlags};

#[derive(Debug, Clone, Copy)]
pub struct BufferDesc<'a, T> {
    size: u64,
    flags: BufferUsageFlags,
    label: &'static str,
    location: MemoryLocation,
    #[debug("{:?}", data.len())]
    data: &'a [T],
}

impl<T: Pod> Default for BufferDesc<'_, T> {
    fn default() -> Self {
        Self {
            size: 0,
            data: &[],
            flags: BufferUsageFlags::empty(),
            label: "unlabeled",
            location: MemoryLocation::GpuToCpu,
        }
    }
}

impl<'a, T: Pod> BufferDesc<'a, T> {
    pub fn flags(mut self, flags: BufferUsageFlags) -> Self {
        self.flags = flags;
        self
    }
    pub fn label(mut self, label: &'static str) -> Self {
        self.label = label;
        self
    }
    pub fn data(mut self, data: &'a [T]) -> Self {
        self.data = data;
        self.size = std::mem::size_of::<T>() as u64 * data.len() as u64;
        self
    }
    pub fn size(mut self, size: u64) -> Self {
        self.size = size;
        self
    }
    fn location(mut self, location: MemoryLocation) -> Self {
        self.location = location;
        self
    }
}

#[derive(Debug)]
pub struct HostBuffer(Buffer);

impl HostBuffer {
    pub fn new<T: Pod>(
        device: Device,
        allocator: Allocator,
        desc: BufferDesc<T>,
    ) -> Result<Self> {
        let desc = desc.location(MemoryLocation::GpuToCpu);
        let buffer = Buffer::new(device, allocator, desc)?;

        Ok(Self(buffer))
    }

    pub fn handle(&self) -> vk::Buffer { self.0.handle() }

    pub fn size(&self) -> u64 { self.0.size() }

    pub fn write<T: bytemuck::Pod>(&self, data: &[T]) { self.0.write(data); }

    pub fn destroy(&self) { self.0.destroy(); }
}

#[derive(Debug)]
pub struct DeviceBuffer(Buffer);

impl DeviceBuffer {
    pub fn new<T: Pod>(
        device: Device,
        allocator: Allocator,
        desc: BufferDesc<T>,
    ) -> Result<Self> {
        let desc = desc
            .location(MemoryLocation::GpuOnly)
            .flags(desc.flags | BufferUsageFlags::SHADER_DEVICE_ADDRESS);
        let buffer = Buffer::new(device, allocator, desc)?;

        Ok(Self(buffer))
    }

    pub fn handle(&self) -> vk::Buffer { self.0.handle() }

    pub fn address(&self) -> DeviceAddress { self.0.address() }

    pub fn size(&self) -> u64 { self.0.size() }

    pub fn destroy(&self) { self.0.destroy(); }
}

#[derive(Debug)]
pub struct SharedBuffer(Buffer);

impl SharedBuffer {
    pub fn new<T: Pod>(
        device: Device,
        allocator: Allocator,
        desc: BufferDesc<T>,
    ) -> Result<Self> {
        let desc = desc.location(MemoryLocation::CpuToGpu);
        let buffer = Buffer::new(device, allocator, desc)?;

        Ok(Self(buffer))
    }

    pub fn handle(&self) -> vk::Buffer { self.0.handle() }

    pub fn write<T: Pod>(&self, data: &[T]) { self.0.write(data) }

    pub fn address(&self) -> DeviceAddress { self.0.address() }
    
    pub fn destroy(&self) { self.0.destroy(); }
}

#[allow(dead_code)]
#[derive(Debug)]
struct Buffer {
    #[debug("{:x}", handle.as_raw())]
    address: DeviceAddress,
    handle: vk::Buffer,
    device: Device,
    allocator: Allocator,
    allocation: RefCell<Allocation>,
    label: &'static str,
    size: u64,
}

impl Buffer {
    pub fn new<T: Pod>(
        device: Device,
        allocator: Allocator,
        desc: BufferDesc<T>,
    ) -> Result<Buffer> {
        let create_info = vk::BufferCreateInfo::default()
            .size(desc.size)
            .usage(desc.flags);
        let handle = unsafe { device.handle.create_buffer(&create_info, None) }?;
        let requirements = unsafe { device.handle.get_buffer_memory_requirements(handle) };
        let allocation = RefCell::new(allocator.allocate_buffer(
            handle,
            requirements,
            desc.location,
            Some(desc.label),
        )?);
        let address = match desc.location {
            MemoryLocation::GpuOnly => {
                let info = vk::BufferDeviceAddressInfo::default().buffer(handle);
                unsafe { device.handle.get_buffer_device_address(&info) }
            }
            _ => DeviceAddress::default(),
        };

        let buffer = Buffer {
            device: device.clone(),
            allocator,
            label: desc.label,
            size: desc.size,
            handle,
            allocation,
            address,
        };

        if !desc.data.is_empty() {
            buffer.write(desc.data);
        }

        Ok(buffer)
    }

    #[inline]
    pub fn address(&self) -> DeviceAddress {
        let info = vk::BufferDeviceAddressInfo::default().buffer(self.handle);
        unsafe { self.device.handle.get_buffer_device_address(&info) }
    }

    #[inline]
    pub fn handle(&self) -> vk::Buffer { self.handle }

    #[inline]
    pub fn size(&self) -> u64 { self.size }

    pub fn write<T: Pod>(&self, data: &[T]) {
        let bytes = bytemuck::cast_slice(data);
        let mut allocation = self.allocation.borrow_mut();
        let mapped = allocation
            .mapped_slice_mut()
            .expect("Failed to map buffer memory");
        let size = mem::size_of_val(bytes);

        mapped[0..size].copy_from_slice(bytes);
    }

    pub fn destroy(&self) {
        log::debug!("Destroying buffer: {:?}", self.label);
        let allocation = self.allocation.replace(Allocation::default());
        self.allocator.deallocate(allocation);
        unsafe { self.device.handle.destroy_buffer(self.handle, None) };
    }
}

impl Drop for Buffer {
    fn drop(&mut self) {
        self.destroy();
    }
}
