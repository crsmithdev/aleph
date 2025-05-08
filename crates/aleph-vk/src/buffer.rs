use {
    crate::{Allocator, Device},
    anyhow::{Ok, Result},
    ash::vk::{self, DeviceAddress},
    bytemuck::Pod,
    derive_more::Debug,
    gpu_allocator::vulkan::Allocation,
    std::{cell::RefCell, mem, rc::Rc, sync::Arc},
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
    pub fn write(&mut self, data: &[T]) { self.buffer.write(bytemuck::cast_slice(data)) }

    #[inline]
    pub fn destroy(self) { self.buffer.destroy() }
}

#[derive(Clone, Debug)]
pub struct RawBuffer {
    address: DeviceAddress,
    handle: vk::Buffer,
    device: Device,
    allocator: Arc<Allocator>,
    allocation: Rc<RefCell<Allocation>>,
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
        let allocation = Rc::new(RefCell::new(allocator.allocate_buffer(
            handle,
            requirements,
            location,
            label,
        )?));

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

    pub fn write(&mut self, data: &[u8]) {
        let mut allocation = self.allocation.borrow_mut();
        let mapped = allocation.mapped_slice_mut().expect("mmmap");
        let bytes = bytemuck::cast_slice(data);
        let size = mem::size_of_val(bytes);

        mapped[0..size].copy_from_slice(bytes);
    }

    pub fn destroy(self) {
        let allocation = Rc::into_inner(self.allocation).map(|cell| cell.into_inner());
        match allocation {
            Some(allocation) => self.allocator.deallocate(allocation),
            None => log::warn!("Error destroying buffer"),
        }

        unsafe { self.device.handle.destroy_buffer(self.handle, None) };
    }
}
