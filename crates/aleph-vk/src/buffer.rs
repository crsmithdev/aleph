use {
    crate::{AllocationHandle, Allocator, Device, Gpu},
    anyhow::Result,
    ash::vk::{BufferCreateInfo, BufferUsageFlags, Handle, SharingMode},
    bytemuck::Pod,
    derive_more::{Debug, Deref},
    gpu_allocator::MemoryLocation,
    std::sync::Arc,
    tracing::trace,
};

#[derive(Clone, Debug)]
pub struct Buffer {
    #[debug("{:#x}", handle.as_raw())]
    handle: ash::vk::Buffer,
    allocation: AllocationHandle,
    #[debug(skip)]
    allocator: Arc<Allocator>,
    size: u64,
    #[debug(skip)]
    device: Device,
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
            handle: buffer,
            device: device.clone(),
            allocation: id,
            allocator: allocator.clone(),
            size,
        })
    }

    pub fn write_offset<T: Copy>(&self, offset: u64, data: &[T]) {
        let mapped_ptr = self
            .allocator
            .get_mapped_ptr(self.allocation)
            .unwrap_or_else(|e| panic!("Error writing to buffer {self:?}: {e}"));

        unsafe {
            let dst = mapped_ptr.add(offset as usize) as *mut T;
            std::ptr::copy_nonoverlapping(data.as_ptr(), dst, data.len());
        }
    }

    pub fn write<T: Pod>(&self, data: &[T]) { self.write_offset(0, data) }

    pub fn handle(&self) -> ash::vk::Buffer { self.handle }

    pub fn size(&self) -> u64 { self.size }

    pub fn destroy(&mut self) {
        unsafe { self.device.handle.destroy_buffer(self.handle, None) };
        self.allocator.deallocate_buffer(self.allocation);
        trace!("Destroyed {self:?}");
    }
}

impl Drop for Buffer {
    fn drop(&mut self) { self.destroy(); }
}

#[derive(Clone, Debug, Deref)]
pub struct TypedBuffer<T: Pod> {
    #[deref]
    buffer: Buffer,
    _phantom: std::marker::PhantomData<T>,
}

impl<T: Pod> TypedBuffer<T> {
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

    pub fn write(&self, data: &[T]) { self.buffer.write(data); }

    pub fn write_offset(&self, offset: u64, data: &[T]) { self.buffer.write_offset(offset, data); }

    pub fn handle(&self) -> ash::vk::Buffer { self.buffer.handle() }

    pub fn size(&self) -> u64 { self.buffer.size() }

    pub fn len(&self) -> usize { (self.buffer.size() / std::mem::size_of::<T>() as u64) as usize }
}

#[cfg(test)]
mod tests {
    use {super::*, crate::test::test_gpu, assay::assay};

    #[assay]
    fn test_buffer_creation() {
        let gpu = test_gpu();
        let buffer = Buffer::new(
            &gpu.device(),
            &gpu.allocator(),
            1024,
            BufferUsageFlags::STORAGE_BUFFER,
            MemoryLocation::GpuOnly,
            "test_buffer",
        )
        .unwrap();

        assert_eq!(buffer.size(), 1024);
        assert_ne!(buffer.handle(), ash::vk::Buffer::null());
    }

    #[assay]
    fn test_buffer_write() {
        let gpu = test_gpu();
        let buffer = Buffer::new(
            &gpu.device(),
            &gpu.allocator(),
            1024,
            BufferUsageFlags::STORAGE_BUFFER,
            MemoryLocation::CpuToGpu,
            "test_write_buffer",
        )
        .unwrap();

        let data = vec![1u32, 2, 3, 4];
        buffer.write(&data);
    }

    #[assay]
    fn test_typed_buffer_vertex() {
        let gpu = test_gpu();
        let buffer: TypedBuffer<f32> = TypedBuffer::vertex(&gpu, 256, "test_vertex").unwrap();
        assert_eq!(buffer.len(), 256);
        assert_eq!(buffer.size(), 256 * 4);
    }

    #[assay]
    fn test_typed_buffer_index() {
        let gpu = test_gpu();
        let buffer: TypedBuffer<u32> = TypedBuffer::index(&gpu, 100, "test_index").unwrap();
        assert_eq!(buffer.len(), 100);
        assert_eq!(buffer.size(), 400);
    }

    #[assay]
    fn test_typed_buffer_storage() {
        let gpu = test_gpu();
        let buffer: TypedBuffer<u64> = TypedBuffer::storage(&gpu, 64, "test_storage").unwrap();
        assert_eq!(buffer.len(), 64);
        assert_eq!(buffer.size(), 512);
    }
}
