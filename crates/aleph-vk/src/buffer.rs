use {
    crate::{Allocator, Device, Gpu},
    anyhow::Result,
    ash::vk::{self, DeviceAddress, Handle as _, MappedMemoryRange},
    bytemuck::Pod,
    derive_more::{Debug, Deref},
    gpu_allocator::vulkan::Allocation,
    std::{cell::RefCell, mem, sync::Arc},
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

#[derive(Debug)]
pub struct BufferView {
    pub offset: u64,
    pub size: u64,
}

#[derive(Debug)]
pub struct TypedBufferView<T> {
    pub offset: u64,
    pub len: usize,
    pub _marker: std::marker::PhantomData<T>,
}

impl<T> TypedBufferView<T> {
    pub fn offset(&self) -> u64 { self.offset }
    pub fn len(&self) -> usize { self.len }
}

impl<T: Pod> TypedBuffer<T> {
    pub fn index(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
        Self::new(
            &gpu,
            size,
            vk::BufferUsageFlags::INDEX_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
            MemoryLocation::CpuToGpu,
            name,
        )
    }
    pub fn vertex(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
        Self::new(
            &gpu,
            size,
            vk::BufferUsageFlags::VERTEX_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
            MemoryLocation::CpuToGpu,
            name,
        )
    }
    pub fn storage(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
        Self::new(
            &gpu,
            size,
            vk::BufferUsageFlags::STORAGE_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
            MemoryLocation::GpuOnly,
            name,
        )
    }
    pub fn uniform(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
        Self::new(
            &gpu,
            size,
            vk::BufferUsageFlags::UNIFORM_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
            MemoryLocation::GpuOnly,
            name,
        )
    }

    pub fn shared_uniform(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
        Self::new(
            &gpu,
            size,
            vk::BufferUsageFlags::UNIFORM_BUFFER,
            MemoryLocation::CpuToGpu,
            name,
        )
    }
    pub fn staging(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
        Self::new(
            &gpu,
            size,
            vk::BufferUsageFlags::TRANSFER_SRC,
            MemoryLocation::CpuToGpu,
            name,
        )
    }

    pub fn new(
        gpu: &Gpu,
        len: usize,
        flags: vk::BufferUsageFlags,
        location: MemoryLocation,
        name: &str,
    ) -> Result<Self> {
        let type_size = mem::size_of::<T>();
        let bytes_size = (type_size * len) as u64;

        let buffer = Buffer::new(
            gpu.device(),
            &gpu.allocator(),
            bytes_size,
            flags,
            location,
            name,
        )?;
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

    pub fn sub_buffer(&self, offset: usize, len: usize) -> TypedBufferView<T> {
        assert!(offset + len <= self.len);
        TypedBufferView {
            offset: (offset * self.type_size) as u64,
            len,
            _marker: std::marker::PhantomData,
        }
    }
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
    allocation: Arc<RefCell<Allocation>>,
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
        let allocation = Arc::new(RefCell::new(allocator.allocate_buffer(
            handle,
            requirements,
            location,
            name.to_string(),
        )?));

        let address = if flags.contains(vk::BufferUsageFlags::SHADER_DEVICE_ADDRESS) {
            let info = vk::BufferDeviceAddressInfo::default().buffer(handle);
            unsafe { device.handle().get_buffer_device_address(&info) }
        } else {
            DeviceAddress::default()
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

        MappedMemoryRange::default().memory(memory).offset(offset).size(size)
    }

    pub fn write(&self, data: &[u8]) {
        let mut allocation = self.allocation.borrow_mut();
        let mapped =
            allocation.mapped_slice_mut().unwrap_or_else(|| panic!("Error mmapping buffer"));

        let bytes = bytemuck::cast_slice(data);
        let size = mem::size_of_val(bytes);

        log::trace!("Writing {size} bytes to {self:?}");
        mapped[0..size].copy_from_slice(bytes);
    }

    pub fn destroy(&mut self) {
        if Arc::strong_count(&self.allocation) == 1 {
            unsafe { self.device.handle.destroy_buffer(self.handle, None) };
            let allocation = mem::take(&mut self.allocation);
            if let Some(cell) = Arc::into_inner(allocation) {
                let inner = cell.take();
                self.allocator.deallocate(inner);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use {
        super::*,
        crate::{test::test_gpu, TypedBuffer},
    };

    #[test]
    fn test_create_typed_buffer() {
        let gpu = test_gpu();
        let result = TypedBuffer::<i32>::new(
            gpu,
            1024,
            BufferUsageFlags::TRANSFER_SRC,
            MemoryLocation::CpuToGpu,
            "test",
        )
        .unwrap();

        assert!(result.name() == "test");
        assert!(result.handle() != vk::Buffer::null());
        assert!(result.len() == 1024);
        assert!(result.size() == 1024 * mem::size_of::<i32>() as u64);
        assert!(result.type_size() == mem::size_of::<i32>());
    }

    #[test]
    fn test_create_buffer() {
        let gpu = test_gpu();
        let buffer = Buffer::new(
            &gpu.device,
            &gpu.allocator,
            1024,
            BufferUsageFlags::TRANSFER_SRC,
            MemoryLocation::CpuToGpu,
            "test_buffer",
        )
        .unwrap();

        assert!(buffer.name() == "test_buffer");
        assert!(buffer.handle() != vk::Buffer::null());
        assert!(buffer.size() == 1024);
    }

    #[test]
    fn test_typed_sub_buffer() {
        let gpu = test_gpu();
        let buffer = TypedBuffer::<i32>::new(
            gpu,
            100,
            BufferUsageFlags::TRANSFER_SRC,
            MemoryLocation::CpuToGpu,
            "test_subbuf",
        )
        .unwrap();
        let sub = buffer.sub_buffer(10, 20);
        assert_eq!(sub.offset(), 10 * std::mem::size_of::<i32>() as u64);
        assert_eq!(sub.len(), 20);
    }
}
