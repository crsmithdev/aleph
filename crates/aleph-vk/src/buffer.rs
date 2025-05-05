use {
    crate::{Allocator, Device},
    anyhow::{Ok, Result},
    ash::vk::{self, DeviceAddress},
    bytemuck::Pod,
    derive_more::Debug,
    gpu_allocator::vulkan::Allocation,
    std::{ffi::c_void, mem, sync::Arc},
};
pub use {gpu_allocator::MemoryLocation, vk::BufferUsageFlags};

#[derive(Debug)]
pub struct Buffer<T> {
    buffer: RawBuffer,
    _marker: std::marker::PhantomData<T>,
}

impl<T: Pod> Buffer<T> {
    pub fn new(
        device: &Device,
        allocator: Arc<Allocator>,
        size: u64,
        flags: vk::BufferUsageFlags,
        location: MemoryLocation,
        label: impl Into<String>,
    ) -> Result<Self> {
        let buffer = RawBuffer::new(device, allocator, size, flags, location, label)?;
        Ok(Self {
            buffer,
            _marker: std::marker::PhantomData,
        })
    }

    pub fn from_data(
        device: &Device,
        allocator: Arc<Allocator>,
        data: &[T],
        flags: vk::BufferUsageFlags,
        location: MemoryLocation,
        label: impl Into<String>,
    ) -> Result<Self> {
        let data2 = bytemuck::cast_slice(&data);
        let size = bytemuck::cast_slice::<u8, u8>(data2).len() as u64;
        let mut buffer = Self::new(device, allocator, size, flags, location, label)?;
        buffer.write(data);
        Ok(buffer)
    }

    #[inline]
    pub fn raw(&self) -> &RawBuffer { &self.buffer }

    #[inline]
    pub fn address(&self) -> DeviceAddress { self.buffer.address }

    #[inline]
    pub fn handle(&self) -> vk::Buffer { self.buffer.handle }

    #[inline]
    pub fn size(&self) -> u64 { self.buffer.size }

    #[inline]
    pub fn mapped_slice_mut(&mut self) -> &[u8] { self.buffer.mapped_slice_mut() }

    #[inline]
    pub fn write(&mut self, data: &[T]) { self.buffer.write(bytemuck::cast_slice(data)) }

    #[inline]
    pub fn mapped_ptr(&self) -> *mut c_void { self.buffer.mapped_ptr() }

    #[inline]
    pub fn destroy(&mut self) { self.buffer.destroy() }
}

#[derive(Debug)]
pub struct RawBuffer {
    address: DeviceAddress,
    handle: vk::Buffer,
    #[debug(skip)]
    device: Device,
    #[debug(skip)]
    allocator: Arc<Allocator>,
    // #[debug("{:x}", allocation.as_ptr() as u64)]
    allocation: Allocation,
    size: u64,
}

impl RawBuffer {
    pub fn new(
        device: &Device,
        allocator: Arc<Allocator>,
        size: u64,
        flags: vk::BufferUsageFlags,
        location: MemoryLocation,
        label: impl Into<String>,
    ) -> Result<Self> {
        let flags = flags | vk::BufferUsageFlags::SHADER_DEVICE_ADDRESS;
        let create_info = vk::BufferCreateInfo::default().size(size).usage(flags);
        let handle = unsafe { device.handle().create_buffer(&create_info, None) }?;
        let requirements = unsafe { device.handle().get_buffer_memory_requirements(handle) };
        let label = &label.into();
        let allocation = allocator.allocate_buffer(handle, requirements, location, label)?;

        let address = match location {
            MemoryLocation::GpuOnly => {
                let info = vk::BufferDeviceAddressInfo::default().buffer(handle);
                unsafe { device.handle().get_buffer_device_address(&info) }
            }
            _ => DeviceAddress::default(),
        };

        Ok(Self {
            device: device.clone(),
            allocator: Arc::clone(&allocator),
            size,
            handle,
            allocation,
            address,
        })
    }

    pub fn from_data(
        device: &Device,
        allocator: Arc<Allocator>,
        data: &[u8],
        flags: vk::BufferUsageFlags,
        location: MemoryLocation,
        label: impl Into<String>,
    ) -> Result<Self> {
        let size = bytemuck::cast_slice::<u8, u8>(data).len() as u64;

        let mut buffer = Self::new(device, allocator, size, flags, location, label)?;
        buffer.write(data);
        Ok(buffer)
    }

    #[inline]
    pub fn address(&self) -> DeviceAddress { self.address }

    #[inline]
    pub fn handle(&self) -> vk::Buffer { self.handle }

    #[inline]
    pub fn size(&self) -> u64 { self.size }

    #[inline]
    pub fn mapped_slice_mut(&mut self) -> &mut [u8] { self.allocation.mapped_slice_mut().unwrap() }

    pub fn mapped_ptr(&self) -> *mut c_void {
        self.allocation
            .mapped_ptr()
            .map_or(std::ptr::null_mut(), |ptr| ptr.as_ptr())
    }

    pub fn write(&mut self, data: &[u8]) {
        let mapped = self.allocation.mapped_slice_mut().expect("mmmap");
        let bytes = bytemuck::cast_slice(data);
        let size = mem::size_of_val(bytes);

        mapped[0..size].copy_from_slice(bytes);
    }

    pub fn destroy(&mut self) {
        let allocation = std::mem::take(&mut self.allocation);
        self.allocator.deallocate(allocation);
        unsafe { self.device.handle.destroy_buffer(self.handle, None) };
    }
}
