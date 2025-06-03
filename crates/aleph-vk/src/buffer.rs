use {
    crate::{
        allocator::AllocationId,
        freelist::{FreeList, FreeListId},
        Allocator, Device, Gpu,
    },
    anyhow::Result,
    ash::vk::{BufferCreateInfo, BufferUsageFlags, SharingMode},
    bytemuck::Pod,
    derive_more::Deref,
    gpu_allocator::MemoryLocation,
    std::sync::Arc,
};

#[derive(Clone, Debug)]
pub struct Buffer {
    handle: ash::vk::Buffer,
    allocation: AllocationId,
    allocator: Arc<Allocator>,
    size: u64,
    sub_allocations: Option<Arc<FreeList>>,
    device: Device,
}
#[derive(Debug)]
pub struct SubBuffer {
    handle: ash::vk::Buffer,
    buffer_id: AllocationId,
    allocator: Arc<Allocator>,
    sub_allocation: FreeListId,
    sub_allocator: Arc<FreeList>,
    offset: u64,
    size: u64,
}

impl SubBuffer {
    pub fn write<T: Pod>(&self, data: &[T]) {
        let mapped_ptr = self
            .allocator
            .get_mapped_ptr(self.buffer_id)
            .unwrap_or_else(|e| panic!("Error writing to {self:?}: {e}"));

        unsafe {
            let dst = mapped_ptr.add(self.offset as usize) as *mut T;
            std::ptr::copy_nonoverlapping(data.as_ptr(), dst, data.len());
        }
    }

    pub fn offset(&self) -> u64 { self.offset }

    pub fn size(&self) -> u64 { self.size }

    pub fn handle(&self) -> ash::vk::Buffer { self.handle }
}

impl Drop for SubBuffer {
    fn drop(&mut self) { self.sub_allocator.free(self.sub_allocation); }
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
            sub_allocations: Some(FreeList::new(size)),
        })
    }

    pub fn sub_buffer(&self, size: u64, alignment: u64) -> Option<SubBuffer> {
        let freelist = self.sub_allocations.as_ref()?;
        let freelist_id = freelist.allocate(size, alignment)?;
        let offset = freelist.offset(freelist_id)?;

        Some(SubBuffer {
            handle: self.handle,
            buffer_id: self.allocation,
            allocator: self.allocator.clone(),
            sub_allocation: freelist_id,
            sub_allocator: freelist.clone(),
            offset,
            size,
        })
    }

    pub fn free_sub_buffer(&self, id: FreeListId) {
        if let Some(ref freelist) = self.sub_allocations {
            freelist.free(id);
        }
    }

    pub fn write<T: Copy>(&self, offset: u64, data: &[T]) -> Result<()> {
        let mapped_ptr = self.allocator.get_mapped_ptr(self.allocation)?;

        unsafe {
            let dst = mapped_ptr.add(offset as usize) as *mut T;
            std::ptr::copy_nonoverlapping(data.as_ptr(), dst, data.len());
        }

        Ok(())
    }

    pub fn handle(&self) -> ash::vk::Buffer { self.handle }

    pub fn size(&self) -> u64 { self.size }
}

impl Drop for Buffer {
    fn drop(&mut self) {
        unsafe { self.device.handle.destroy_buffer(self.handle, None) };
        self.allocator.deallocate_buffer(self.allocation);
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

    pub fn size(&self) -> u64 { self.buffer.size() }

    pub fn len(&self) -> usize { (self.buffer.size() / std::mem::size_of::<T>() as u64) as usize }

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
        buffer.write(0, &data).unwrap();
    }

    #[assay]
    fn test_sub_buffer_allocation() {
        let gpu = test_gpu();
        let buffer = Buffer::new(
            &gpu.device(),
            &gpu.allocator(),
            1024,
            BufferUsageFlags::STORAGE_BUFFER,
            MemoryLocation::CpuToGpu,
            "test_parent_buffer",
        )
        .unwrap();

        let sub_buffer = buffer.sub_buffer(256, 16).unwrap();
        assert_eq!(sub_buffer.size(), 256);
        assert_eq!(sub_buffer.handle(), buffer.handle());
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
            "test_sub_write_buffer",
        )
        .unwrap();

        let sub_buffer = buffer.sub_buffer(256, 4).unwrap();
        let data = vec![42u32, 43, 44, 45];
        sub_buffer.write(&data);
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

    #[assay]
    fn test_typed_buffer_write_all() {
        let gpu = test_gpu();
        let buffer: TypedBuffer<i32> = TypedBuffer::staging(&gpu, 4, "test_staging").unwrap();
        let data = vec![-1, -2, -3, -4];
        buffer.write_all(&data).unwrap();
    }

    #[assay]
    fn test_typed_buffer_write_offset() {
        let gpu = test_gpu();
        let buffer: TypedBuffer<u16> =
            TypedBuffer::shared_uniform(&gpu, 16, "test_uniform").unwrap();
        let data = vec![0xDEAD, 0xBEEF];
        buffer.write(2, &data).unwrap();
    }

    #[assay]
    fn test_multiple_sub_buffers() {
        let gpu = test_gpu();
        let buffer = Buffer::new(
            &gpu.device(),
            &gpu.allocator(),
            1024,
            BufferUsageFlags::STORAGE_BUFFER,
            MemoryLocation::CpuToGpu,
            "test_multi_sub",
        )
        .unwrap();

        let sub1 = buffer.sub_buffer(256, 4).unwrap();
        let sub2 = buffer.sub_buffer(128, 4).unwrap();
        let sub3 = buffer.sub_buffer(64, 4).unwrap();

        assert_ne!(sub1.offset(), sub2.offset());
        assert_ne!(sub2.offset(), sub3.offset());
        assert!(sub1.offset() + sub1.size() <= buffer.size());
    }
}
