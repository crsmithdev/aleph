pub use gavk::Allocation;
use {
    crate::{BufferInfo, Device, Instance},
    anyhow::Result,
    ash::vk,
    derive_more::Debug,
    gpu_allocator::{
        self as ga,
        vulkan::{self as gavk},
        MemoryLocation,
    },
    std::sync::{Arc, Mutex},
};

#[derive(Debug)]
pub struct Allocator {
    inner: Box<dyn AllocatorInner>,
}

impl Default for Allocator {
    fn default() -> Self {
        Self {
            inner: Box::new(StubAllocator {}),
        }
    }
}

impl Allocator {
    pub fn new(instance: &Instance, device: &Device) -> Result<Self> {
        let inner = Box::new(MemoryAllocator::new(instance, device)?);
        Ok(Self { inner })
    }

    pub fn allocate_buffer(&self, buffer: vk::Buffer, info: BufferInfo) -> Result<Allocation> {
        self.inner.allocate_buffer(buffer, info)
    }
    pub fn destroy_buffer(&self, buffer: vk::Buffer, allocation: &mut Allocation) {
        self.inner.destroy_buffer(buffer, allocation)
    }
    pub fn allocate_image(&self, info: &vk::ImageCreateInfo) -> Result<(vk::Image, Allocation)> {
        self.inner.allocate_image(info)
    }
    pub fn destroy_image(&self, image: vk::Image, view: vk::ImageView, allocation: Allocation) {
        self.inner.destroy_image(image, view, allocation)
    }
}

trait AllocatorInner: Send + Sync + Debug {
    fn allocate_buffer(&self, buffer: vk::Buffer, info: BufferInfo) -> Result<Allocation>;
    fn destroy_buffer(&self, buffer: vk::Buffer, allocation: &mut Allocation);
    fn allocate_image(&self, info: &vk::ImageCreateInfo) -> Result<(vk::Image, Allocation)>;
    fn destroy_image(&self, image: vk::Image, view: vk::ImageView, allocation: Allocation);
}

#[derive(Debug)]
struct StubAllocator {}
impl AllocatorInner for StubAllocator {
    fn allocate_buffer(&self, _buffer: vk::Buffer, _info: BufferInfo) -> Result<Allocation> {
        todo!()
    }

    fn destroy_buffer(&self, _buffer: vk::Buffer, _allocation: &mut Allocation) {
        todo!()
    }

    fn allocate_image(&self, _info: &vk::ImageCreateInfo) -> Result<(vk::Image, Allocation)> {
        todo!()
    }

    fn destroy_image(&self, _image: vk::Image, _view: vk::ImageView, _allocation: Allocation) {
        todo!()
    }
}

#[derive(Debug)]
pub struct MemoryAllocator {
    pub(crate) inner: Arc<Mutex<gavk::Allocator>>,
    pub(crate) device: crate::Device,
}

impl MemoryAllocator {
    pub fn inner(&self) -> &Arc<Mutex<gavk::Allocator>> {
        &self.inner
    }
    pub fn new(instance: &Instance, device: &Device) -> Result<Self> {
        let allocator = gavk::Allocator::new(&gavk::AllocatorCreateDesc {
            instance: instance.handle.clone(),
            physical_device: device.physical_device,
            device: device.handle.clone(),
            buffer_device_address: true,
            debug_settings: ga::AllocatorDebugSettings::default(),
            allocation_sizes: ga::AllocationSizes::default(),
        })?;

        Ok(Self {
            inner: Arc::new(Mutex::new(allocator)),
            device: device.clone(),
        })
    }
}

impl AllocatorInner for MemoryAllocator {
    fn allocate_buffer(&self, buffer: vk::Buffer, info: BufferInfo) -> Result<Allocation> {
        let requirements = unsafe { self.device.handle.get_buffer_memory_requirements(buffer) };

        let mut allocator = self
            .inner
            .lock()
            .expect("Could not acquire lock on allocator");
        let allocation = allocator.allocate(&gavk::AllocationCreateDesc {
            name: info.label.unwrap_or("default"),
            requirements,
            location: info.location,
            linear: true,
            allocation_scheme: gavk::AllocationScheme::GpuAllocatorManaged,
        })?;

        unsafe {
            self.device
                .handle
                .bind_buffer_memory(buffer, allocation.memory(), allocation.offset())
        }?;

        Ok(allocation)
    }

    fn destroy_buffer(&self, buffer: vk::Buffer, allocation: &mut Allocation) {
        self.inner
            .lock()
            .unwrap()
            .free(std::mem::take(allocation))
            .unwrap();
        unsafe { self.device.handle.destroy_buffer(buffer, None) };
    }

    fn allocate_image(&self, info: &vk::ImageCreateInfo) -> Result<(vk::Image, Allocation)> {
        let image = unsafe { self.device.create_image(info, None) }?;
        let requirements = unsafe { self.device.get_image_memory_requirements(image) };
        let mut allocator = self.inner.lock().unwrap();
        let allocation = allocator.allocate(&ga::vulkan::AllocationCreateDesc {
            name: "Image",
            requirements,
            location: MemoryLocation::GpuOnly,
            linear: false,
            allocation_scheme: ga::vulkan::AllocationScheme::GpuAllocatorManaged,
        })?;
        unsafe {
            self.device
                .bind_image_memory(image, allocation.memory(), allocation.offset())
        }?;
        Ok((image, allocation))
    }

    fn destroy_image(&self, image: vk::Image, view: vk::ImageView, allocation: Allocation) {
        unsafe {
            self.inner.lock().unwrap().free(allocation).unwrap();
            self.device.handle.destroy_image(image, None);
            self.device.handle.destroy_image_view(view, None);
        };
    }
}
