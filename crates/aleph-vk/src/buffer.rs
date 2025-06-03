use {
    crate::{allocator::AllocationId, Allocator, Device, Gpu},
    anyhow::Result,
    ash::vk::{BufferCreateInfo, BufferUsageFlags, SharingMode},
    derive_more::Deref,
    gpu_allocator::MemoryLocation,
    std::sync::Arc,
};

#[derive(Debug)]
pub struct Buffer {
    id: AllocationId,
    allocator: Arc<Allocator>,
    size: u64,
    location: MemoryLocation,
}

impl Buffer {
    pub fn new(
        device: &Device,
        allocator: &Arc<Allocator>,
        size: u64,
        usage: BufferUsageFlags,
        location: MemoryLocation,
        name: &str,
    ) -> Result<Self> {
        let create_info = BufferCreateInfo::default()
            .size(size)
            .usage(usage)
            .sharing_mode(SharingMode::EXCLUSIVE);

        let buffer = unsafe { device.handle.create_buffer(&create_info, None) }?;
        let requirements = unsafe { device.handle.get_buffer_memory_requirements(buffer) };

        let id = allocator.allocate_buffer(buffer, requirements, location, name)?;

        Ok(Self {
            id,
            allocator: allocator.clone(),
            size,
            location,
        })
    }

    pub fn write<T: Copy>(&self, offset: u64, data: &[T]) -> Result<()> {
        self.allocator.write_buffer(self.id, offset, data)
    }

    pub fn write_all<T: Copy>(&self, data: &[T]) -> Result<()> { self.write(0, data) }

    pub fn handle(&self) -> ash::vk::Buffer { self.allocator.get_buffer(self.id) }

    pub fn size(&self) -> u64 { self.size }
}
impl Drop for Buffer {
    fn drop(&mut self) { self.allocator.deallocate(self.id); }
}

impl Clone for Buffer {
    fn clone(&self) -> Self {
        Self {
            id: self.id,
            allocator: self.allocator.clone(),
            size: self.size,
            location: self.location,
        }
    }
}
#[derive(Debug, Deref)]
pub struct TypedBuffer<T> {
    #[deref]
    buffer: Buffer,
    _phantom: std::marker::PhantomData<T>,
}

impl<T: Copy> TypedBuffer<T> {
    pub fn index(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
        Self::new(
            &gpu.device(),
            &gpu.allocator(),
            size,
            BufferUsageFlags::INDEX_BUFFER | BufferUsageFlags::TRANSFER_DST,
            MemoryLocation::CpuToGpu,
            name,
        )
    }
    pub fn vertex(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
        Self::new(
            &gpu.device(),
            &gpu.allocator(),
            size,
            BufferUsageFlags::VERTEX_BUFFER | BufferUsageFlags::TRANSFER_DST,
            MemoryLocation::CpuToGpu,
            name,
        )
    }
    pub fn storage(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
        Self::new(
            &gpu.device(),
            &gpu.allocator(),
            size,
            BufferUsageFlags::STORAGE_BUFFER | BufferUsageFlags::TRANSFER_DST,
            MemoryLocation::GpuOnly,
            name,
        )
    }
    pub fn uniform(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
        Self::new(
            &gpu.device(),
            &gpu.allocator(),
            size,
            BufferUsageFlags::UNIFORM_BUFFER | BufferUsageFlags::TRANSFER_DST,
            MemoryLocation::GpuOnly,
            name,
        )
    }

    pub fn shared_uniform(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
        Self::new(
            &gpu.device(),
            &gpu.allocator(),
            size,
            BufferUsageFlags::UNIFORM_BUFFER,
            MemoryLocation::CpuToGpu,
            name,
        )
    }
    pub fn staging(gpu: &Gpu, size: usize, name: &str) -> Result<Self> {
        Self::new(
            &gpu.device(),
            &gpu.allocator(),
            size,
            BufferUsageFlags::TRANSFER_SRC,
            MemoryLocation::CpuToGpu,
            name,
        )
    }
    pub fn new(
        device: &Device,
        allocator: &Arc<Allocator>,
        count: usize,
        usage: BufferUsageFlags,
        location: MemoryLocation,
        name: &str,
    ) -> Result<Self> {
        let size = (count * std::mem::size_of::<T>()) as u64;
        let buffer = Buffer::new(device, allocator, size, usage, location, name)?;

        Ok(Self {
            buffer,
            _phantom: std::marker::PhantomData,
        })
    }

    pub fn write(&self, offset: usize, data: &[T]) -> Result<()> {
        let byte_offset = (offset * std::mem::size_of::<T>()) as u64;
        self.buffer.write(byte_offset, data)
    }

    pub fn write_all(&self, data: &[T]) -> Result<()> { self.write(0, data) }

    pub fn handle(&self) -> ash::vk::Buffer { self.buffer.handle() }

    pub fn size_bytes(&self) -> u64 { self.buffer.size() }

    pub fn count(&self) -> usize { (self.buffer.size() / std::mem::size_of::<T>() as u64) as usize }

    pub fn buffer(&self) -> &Buffer { &self.buffer }
}

impl<T> Clone for TypedBuffer<T> {
    fn clone(&self) -> Self {
        Self {
            buffer: self.buffer.clone(),
            _phantom: std::marker::PhantomData,
        }
    }
}
#[cfg(test)]
mod tests {
    use {super::*, crate::test::test_gpu};

    #[test]
    #[cfg(feature = "gpu-tests")]
    fn test_buffer_creation() {
        let gpu = test_gpu();
        let buffer = Buffer::new(
            gpu.device(),
            &gpu.allocator(),
            1024,
            BufferUsageFlags::VERTEX_BUFFER,
            MemoryLocation::CpuToGpu,
            "test_buffer",
        )
        .expect("Failed to create buffer");

        assert_eq!(buffer.size(), 1024);
    }

    #[test]
    #[cfg(feature = "gpu-tests")]
    fn test_buffer_write() {
        let gpu = test_gpu();
        let buffer = Buffer::new(
            gpu.device(),
            &gpu.allocator(),
            64,
            BufferUsageFlags::UNIFORM_BUFFER,
            MemoryLocation::CpuToGpu,
            "test_write_buffer",
        )
        .expect("Failed to create buffer");

        let data: [u32; 4] = [1, 2, 3, 4];
        buffer.write_all(&data).expect("Failed to write buffer");
    }

    #[test]
    #[cfg(feature = "gpu-tests")]
    fn test_buffer_clone() {
        let gpu = test_gpu();
        let buffer1 = Buffer::new(
            gpu.device(),
            &gpu.allocator(),
            256,
            BufferUsageFlags::STORAGE_BUFFER,
            MemoryLocation::CpuToGpu,
            "test_clone_buffer",
        )
        .expect("Failed to create buffer");

        let buffer2 = buffer1.clone();
        assert_eq!(buffer1.handle(), buffer2.handle());
        assert_eq!(buffer1.size(), buffer2.size());
    }
}
