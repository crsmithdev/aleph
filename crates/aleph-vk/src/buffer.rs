use {
    crate::{
        allocator::AllocationId,
        freelist::{FreeList, FreeListId},
        Allocator, Device, Gpu,
    },
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
    freelist: Option<Arc<FreeList>>,
}
#[derive(Debug)]
pub struct SubBuffer {
    buffer_id: AllocationId,
    allocator: Arc<Allocator>,
    pub(crate) freelist_id: FreeListId,
    freelist: Arc<FreeList>,
    offset: u64,
    size: u64,
}

impl SubBuffer {
    pub fn write<T: Copy>(&self, offset: u64, data: &[T]) -> Result<()> {
        let absolute_offset = self.offset + offset;
        self.allocator.write_buffer(self.buffer_id, absolute_offset, data)
    }

    pub fn write_all<T: Copy>(&self, data: &[T]) -> Result<()> { self.write(0, data) }

    pub fn offset(&self) -> u64 { self.offset }

    pub fn size(&self) -> u64 { self.size }

    pub fn handle(&self) -> ash::vk::Buffer { self.allocator.get_buffer(self.buffer_id) }
}

impl Drop for SubBuffer {
    fn drop(&mut self) { self.freelist.free(self.freelist_id); }
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
            freelist: Some(FreeList::new(size)),
        })
    }

    pub fn sub_allocate(&self, size: u64, alignment: u64) -> Option<SubBuffer> {
        let freelist = self.freelist.as_ref()?;
        let freelist_id = freelist.allocate(size, alignment)?;
        let offset = freelist.offset(freelist_id)?;

        Some(SubBuffer {
            buffer_id: self.id,
            allocator: self.allocator.clone(),
            freelist_id: freelist_id,
            freelist: freelist.clone(),
            offset,
            size,
        })
    }

    pub fn sub_free(&self, id: FreeListId) {
        if let Some(ref freelist) = self.freelist {
            freelist.free(id);
        }
    }

    pub fn sub_write<T: Copy>(&self, id: FreeListId, offset: u64, data: &[T]) -> Result<()> {
        if let Some(ref freelist) = self.freelist {
            if let Some(base_offset) = freelist.offset(id) {
                let absolute_offset = base_offset + offset;
                return self.allocator.write_buffer(self.id, absolute_offset, data);
            }
        }
        panic!("Invalid sub-allocation ID: {:?}", id);
    }

    pub fn sub_offset(&self, id: FreeListId) -> Option<u64> {
        self.freelist.as_ref().and_then(|fl| fl.offset(id))
    }

    pub fn sub_size(&self, id: FreeListId) -> Option<u64> {
        self.freelist.as_ref().and_then(|fl| fl.size(id))
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
            freelist: self.freelist.clone(),
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
    }

    #[assay]
    fn test_typed_buffer_creation() {
        let gpu = test_gpu();
        let buffer = TypedBuffer::<u32>::new(
            &gpu.device(),
            &gpu.allocator(),
            256,
            BufferUsageFlags::STORAGE_BUFFER,
            MemoryLocation::CpuToGpu,
            "typed_test",
        )
        .unwrap();

        assert_eq!(buffer.count(), 256);
        assert_eq!(buffer.size_bytes(), 256 * 4);
    }

    #[assay]
    fn test_sub_allocation() {
        let gpu = test_gpu();
        let buffer = Buffer::new(
            &gpu.device(),
            &gpu.allocator(),
            1024,
            BufferUsageFlags::STORAGE_BUFFER,
            MemoryLocation::CpuToGpu,
            "sub_alloc_test",
        )
        .unwrap();

        let sub1 = buffer.sub_allocate(256, 16).unwrap();
        let sub2 = buffer.sub_allocate(128, 16).unwrap();

        assert_eq!(sub1.size(), 256);
        assert_eq!(sub2.size(), 128);
        assert_ne!(sub1.offset(), sub2.offset());
    }

    #[assay]
    fn test_buffer_write() {
        let gpu = test_gpu();
        let buffer = TypedBuffer::<u32>::staging(&gpu, 10, "write_test").unwrap();
        let data = vec![1u32, 2, 3, 4, 5];

        buffer.write_all(&data).unwrap();
    }

    #[assay]
    fn test_sub_buffer_write() {
        let gpu = test_gpu();
        let buffer = Buffer::new(
            &gpu.device(),
            &gpu.allocator(),
            1024,
            BufferUsageFlags::STORAGE_BUFFER,
            MemoryLocation::CpuToGpu,
            "sub_write_test",
        )
        .unwrap();

        let sub = buffer.sub_allocate(64, 4).unwrap();
        let data = vec![42u32, 43, 44, 45];

        sub.write_all(&data).unwrap();
    }

    #[assay]
    fn test_typed_buffer_convenience_methods() {
        let gpu = test_gpu();

        let _vertex_buf = TypedBuffer::<f32>::vertex(&gpu, 100, "vertices").unwrap();
        let _index_buf = TypedBuffer::<u32>::index(&gpu, 50, "indices").unwrap();
        let _uniform_buf = TypedBuffer::<[f32; 16]>::uniform(&gpu, 1, "mvp").unwrap();
        let _storage_buf = TypedBuffer::<u32>::storage(&gpu, 1000, "data").unwrap();
    }

    #[assay]
    fn test_buffer_clone() {
        let gpu = test_gpu();
        let buffer = TypedBuffer::<u32>::staging(&gpu, 10, "clone_test").unwrap();
        let cloned = buffer.clone();

        assert_eq!(buffer.count(), cloned.count());
        assert_eq!(buffer.size_bytes(), cloned.size_bytes());
    }
}
