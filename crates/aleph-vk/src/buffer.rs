use {
    crate::{Allocator, Device, DeviceAddress, Gpu},
    anyhow::{Ok, Result},
    ash::vk::{self, Handle, MappedMemoryRange},
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
    type_size: usize,
    len: usize,
    #[debug(skip)]
    _marker: std::marker::PhantomData<T>,
}

impl<T: Pod> TypedBuffer<T> {
    pub fn index(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
        Self::new(
            &gpu.device,
            &gpu.allocator,
            size,
            vk::BufferUsageFlags::INDEX_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
            MemoryLocation::CpuToGpu,
            name,
        )
    }
    pub fn vertex(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
        Self::new(
            &gpu.device,
            &gpu.allocator,
            size,
            vk::BufferUsageFlags::VERTEX_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
            MemoryLocation::CpuToGpu,
            name,
        )
    }
    pub fn storage(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
        Self::new(
            &gpu.device,
            &gpu.allocator,
            size,
            vk::BufferUsageFlags::STORAGE_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
            MemoryLocation::GpuOnly,
            name,
        )
    }
    pub fn uniform(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
        Self::new(
            &gpu.device,
            &gpu.allocator,
            size,
            vk::BufferUsageFlags::UNIFORM_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
            MemoryLocation::GpuOnly,
            name,
        )
    }

    pub fn shared_uniform(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
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
            size,
            vk::BufferUsageFlags::TRANSFER_SRC,
            MemoryLocation::CpuToGpu,
            name,
        )
    }

    pub fn new(
        device: &Device,
        allocator: &Arc<Allocator>,
        len: usize,
        flags: vk::BufferUsageFlags,
        location: MemoryLocation,
        name: &str,
    ) -> Result<Self> {
        let type_size = mem::size_of::<T>();
        let bytes_size = (type_size * len) as u64;

        let buffer = Buffer::new(device, allocator, bytes_size, flags, location, name)?;
        Ok(Self {
            buffer,
            type_size,
            len,
            _marker: std::marker::PhantomData,
        })
    }

    #[inline]
    pub fn address(&self) -> DeviceAddress { self.buffer.address }

    #[inline]
    pub fn handle(&self) -> vk::Buffer { self.buffer.handle }

    #[inline]
    pub fn len(&self) -> usize { self.len }

    #[inline]
    pub fn type_size(&self) -> usize { self.type_size }

    #[inline]
    pub fn write(&mut self, data: &[T]) { self.buffer.write(bytemuck::cast_slice(data)) }
}

impl<T> Drop for TypedBuffer<T> {
    fn drop(&mut self) {
        log::debug!("Dropped buffer: {self:?}");
        self.buffer.destroy();
    }
}

#[derive(Clone, Debug, Deref)]
pub struct Buffer {
    #[debug("{:#x}", address)]
    address: DeviceAddress,
    #[deref]
    #[debug("{:#x}", handle.as_raw())]
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

    #[inline]
    pub fn len(&self) -> usize { self.size as usize }

    pub fn mapped_memory_range(&self) -> vk::MappedMemoryRange {
        let atom_size = self.device.properties().limits.non_coherent_atom_size;
        let size = (self.size - 1) - ((self.size - 1) % atom_size) + atom_size;

        let (memory, offset) = {
            let allocation = self.allocation.borrow();
            let memory = unsafe { allocation.memory() };
            let offset = allocation.offset();
            (memory, offset)
        };

        MappedMemoryRange::default()
            .memory(memory)
            .offset(offset)
            .size(size)
    }

    pub fn write(&self, data: &[u8]) {
        let mut allocation = self.allocation.borrow_mut();
        let mapped = allocation
            .mapped_slice_mut()
            .unwrap_or_else(|| panic!("Error mmapping buffer"));

        let bytes = bytemuck::cast_slice(data);
        let size = mem::size_of_val(bytes);

        log::trace!("Writing {size} bytes to {self:?}");
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
    use {
        super::*,
        crate::{test::test_gpu, TypedBuffer},
    };

    #[test]
    fn test_create_write_buffer() {
        let gpu = test_gpu();
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

    #[test]
    fn test_size_typed_untyped() {
        let gpu = test_gpu();
        let buffer = TypedBuffer::<i32>::uniform(&gpu, 256, "test").unwrap();
        assert_eq!(buffer.type_size(), mem::size_of::<i32>() as usize);
        assert_eq!(buffer.size(), 256 * mem::size_of::<i32>() as u64);
        assert_eq!(buffer.len(), 256);
    }
}
