use {
    crate::{Allocator, Device, DeviceAddress, Gpu},
    anyhow::{Ok, Result},
    ash::vk::{self, Handle},
    bytemuck::Pod,
    derive_more::{Debug, Deref},
    gpu_allocator::vulkan::Allocation,
    std::{cell::RefCell, mem, rc::Rc, sync::Arc},
    tracing::instrument,
};
pub use {gpu_allocator::MemoryLocation, vk::BufferUsageFlags};

#[derive(Clone, Debug, Deref)]
pub struct TypedBuffer<T> {
    #[deref]
    buffer: Buffer,
    #[debug(skip)]
    _marker: std::marker::PhantomData<T>,
}

impl<T: Pod> TypedBuffer<T> {
    pub fn index(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
        Self::new(
            &gpu.device,
            &gpu.allocator,
            size as u64,
            vk::BufferUsageFlags::INDEX_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
            MemoryLocation::GpuOnly,
            name,
        )
    }
    pub fn vertex(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
        Self::new(
            &gpu.device,
            &gpu.allocator,
            size as u64,
            vk::BufferUsageFlags::VERTEX_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
            MemoryLocation::GpuOnly,
            name,
        )
    }
    pub fn storage(gpu: &Gpu, size: u64, name: &str) -> Result<Self> {
        Self::new(
            &gpu.device,
            &gpu.allocator,
            size,
            vk::BufferUsageFlags::STORAGE_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
            MemoryLocation::GpuOnly,
            name,
        )
    }
    pub fn uniform(gpu: &Gpu, size: u64, name: &str) -> Result<Self> {
        Self::new(
            &gpu.device,
            &gpu.allocator,
            size,
            vk::BufferUsageFlags::UNIFORM_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
            MemoryLocation::GpuOnly,
            name,
        )
    }

    pub fn shared_uniform(gpu: &Gpu, size: u64, name: &str) -> Result<Self> {
        Self::new(
            &gpu.device,
            &gpu.allocator,
            size,
            vk::BufferUsageFlags::UNIFORM_BUFFER,
            MemoryLocation::CpuToGpu,
            name,
        )
    }
    pub fn staging(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
        Self::new(
            &gpu.device,
            &gpu.allocator,
            size as u64,
            vk::BufferUsageFlags::TRANSFER_SRC,
            MemoryLocation::CpuToGpu,
            name,
        )
    }

    pub fn with_data(
        gpu: &Gpu,
        data: &[T],
        flags: vk::BufferUsageFlags,
        location: MemoryLocation,
        name: &str,
    ) -> Result<Self> {
        let data2 = bytemuck::cast_slice(&data);
        let size = bytemuck::cast_slice::<u8, u8>(data2).len() as u64;
        let mut buffer = Self::new(&gpu.device, &gpu.allocator, size, flags, location, name)?;

        buffer.write(data);
        Ok(buffer)
    }

    pub fn new(
        device: &Device,
        allocator: &Arc<Allocator>,
        size: u64,
        flags: vk::BufferUsageFlags,
        location: MemoryLocation,
        name: &str,
    ) -> Result<Self> {
        let size = size * mem::size_of::<T>() as u64;
        let buffer = Buffer::new(device, allocator, size, flags, location, name)?;
        Ok(Self {
            buffer,
            _marker: std::marker::PhantomData,
        })
    }

    #[inline]
    pub fn address(&self) -> DeviceAddress { self.buffer.address }

    #[inline]
    pub fn handle(&self) -> vk::Buffer { self.buffer.handle }

    #[inline]
    pub fn size(&self) -> u64 { self.buffer.size }

    #[inline]
    pub fn write(&mut self, data: &[T]) { self.buffer.write(bytemuck::cast_slice(data)) }
}

impl<T> Drop for TypedBuffer<T> {
    fn drop(&mut self) {
        log::debug!("Dropped buffer: {self:?}");
        self.buffer.destroy();
    }
}

#[derive(Clone, Debug)]
pub struct Buffer {
    #[debug("{:x}", address)]
    address: DeviceAddress,
    #[debug("{:x}", handle.as_raw())]
    handle: vk::Buffer,
    #[debug(skip)]
    device: Device,
    #[debug(skip)]
    allocator: Arc<Allocator>,
    #[debug("{:?}", allocation.as_ptr())]
    allocation: Rc<RefCell<Allocation>>,
    #[debug("{}b", size)]
    size: u64,
    name: String,
}

impl Buffer {
    #[instrument(skip_all)]
    pub fn new(
        device: &Device,
        allocator: &Arc<Allocator>,
        size: u64,
        flags: vk::BufferUsageFlags,
        location: MemoryLocation,
        name: &str,
    ) -> Result<Self> {
        let name = name.to_string();
        let device = device.clone();
        let allocator = Arc::clone(&allocator);
        let flags = flags | vk::BufferUsageFlags::SHADER_DEVICE_ADDRESS;
        let create_info = vk::BufferCreateInfo::default().size(size).usage(flags);
        let handle = unsafe { device.handle().create_buffer(&create_info, None) }?;
        let requirements = unsafe { device.handle().get_buffer_memory_requirements(handle) };
        let allocation = Rc::new(RefCell::new(allocator.allocate_buffer(
            handle,
            requirements,
            location,
            name.to_string(),
        )?));

        let address = match location {
            MemoryLocation::GpuOnly => {
                let info = vk::BufferDeviceAddressInfo::default().buffer(handle);
                unsafe { device.handle().get_buffer_device_address(&info) }
            }
            _ => DeviceAddress::default(),
        };

        let buffer = Self {
            device: device.clone(),
            allocator: Arc::clone(&allocator),
            size,
            handle,
            allocation,
            address,
            name,
        };
        log::trace!("Created {:?}", buffer);
        Ok(buffer)
    }

    #[inline]
    pub fn name(&self) -> &str { &self.name }

    #[inline]
    pub fn address(&self) -> DeviceAddress { self.address }

    #[inline]
    pub fn handle(&self) -> vk::Buffer { self.handle }

    #[inline]
    pub fn size(&self) -> u64 { self.size }

    pub fn write(&self, data: &[u8]) {
        let mut allocation = self.allocation.borrow_mut();
        let mapped = allocation.mapped_slice_mut().expect("mmmap");
        let bytes = bytemuck::cast_slice(data);
        let size = mem::size_of_val(bytes);

        mapped[0..size].copy_from_slice(bytes);
    }

    pub fn destroy(&mut self) {
        let allocation = Rc::get_mut(&mut self.allocation).map(|cell| cell.take());
        match allocation {
            Some(allocation) => self.allocator.deallocate(allocation),
            None => log::warn!("Error destroying buffer"),
        }

        unsafe { self.device.handle.destroy_buffer(self.handle, None) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_write_buffer() {
        let gpu = Gpu::headless().unwrap();
        let result = TypedBuffer::<i32>::new(
            &gpu.device,
            &gpu.allocator,
            1024,
            BufferUsageFlags::TRANSFER_SRC,
            MemoryLocation::CpuToGpu,
            "test",
        )
        .map(|mut b| b.write(&[1, 2, 3, 4]));

        assert!(
            result.is_ok(),
            "Failed to create buffer: {:?}",
            result.err()
        );
    }
}
