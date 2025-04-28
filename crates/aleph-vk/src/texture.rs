use {
    crate::{
        Allocator, Buffer, BufferUsageFlags, CommandBuffer, Device, Extent2D, Filter, Format,
        ImageAspectFlags, ImageUsageFlags, MemoryLocation, SamplerAddressMode, SamplerMipmapMode,
    },
    anyhow::Result,
    ash::vk,
    bytemuck::Pod,
    derive_more::Debug,
    gpu_allocator::vulkan::Allocation,
    std::sync::Arc,
};

#[derive(Debug)]
pub struct SamplerDesc {
    pub name: String,
    pub index: usize,
    pub min_filter: Filter,
    pub mag_filter: Filter,
    pub mipmap_mode: SamplerMipmapMode,
    pub address_mode_u: SamplerAddressMode,
    pub address_mode_v: SamplerAddressMode,
    pub anisotropy_enable: bool,
    pub max_anisotropy: f32,
}

impl Default for SamplerDesc {
    fn default() -> Self {
        Self {
            name: "sa-default".into(),
            index: 0,
            min_filter: Filter::LINEAR,
            mag_filter: Filter::LINEAR,
            mipmap_mode: SamplerMipmapMode::LINEAR,
            address_mode_u: SamplerAddressMode::REPEAT,
            address_mode_v: SamplerAddressMode::REPEAT,
            anisotropy_enable: false,
            max_anisotropy: 1.0,
        }
    }
}

#[derive(Debug)]
pub struct TextureDesc {
    pub name: String,
    pub extent: Extent2D,
    pub format: Format,
    pub usage: ImageUsageFlags,
    pub aspect: ImageAspectFlags,
    pub data: Vec<u8>,
    pub sampler: SamplerDesc,
}

macro_rules! impl_image {
    ($mty:ident) => {
        impl Texture for $mty {
            fn handle(&self) -> vk::Image { self.image.handle }
            fn view(&self) -> vk::ImageView { self.view }
            fn extent(&self) -> Extent2D { self.image.extent }
            fn format(&self) -> Format { self.image.format }
            fn label(&self) -> &str { &self.image.name }
            fn sampler(&self) -> Option<vk::Sampler> { self.image.sampler }
        }
        impl<'a> Texture for &'a $mty {
            fn handle(&self) -> vk::Image { self.image.handle }
            fn view(&self) -> vk::ImageView { self.view }
            fn extent(&self) -> Extent2D { self.image.extent }
            fn format(&self) -> Format { self.image.format }
            fn label(&self) -> &str { &self.image.name }
            fn sampler(&self) -> Option<vk::Sampler> { self.image.sampler }
        }
    };
}

pub trait Texture {
    fn handle(&self) -> vk::Image;
    fn view(&self) -> vk::ImageView;
    fn extent(&self) -> Extent2D;
    fn format(&self) -> Format;
    fn label(&self) -> &str;
    fn sampler(&self) -> Option<vk::Sampler>;
}

#[allow(dead_code)]
#[derive(Debug)]
pub struct AllocatedTexture {
    image: Image,
    allocation: Allocation,
    allocator: Arc<Allocator>,
    device: Device,
    sampler: Option<vk::Sampler>,
    view: vk::ImageView,
}

impl_image!(AllocatedTexture);

impl AllocatedTexture {
    pub fn new(
        device: Device,
        allocator: Arc<Allocator>,
        extent: Extent2D,
        format: Format,
        usage: ImageUsageFlags,
        aspect_flags: ImageAspectFlags,
        name: impl Into<String>,
        sampler: Option<vk::Sampler>,
    ) -> Result<Self> {
        let name = name.into();
        let image = Image::new(device.clone(), extent, format, usage, name.clone(), None)?;
        let requirements = unsafe { device.handle.get_image_memory_requirements(image.handle) };
        let allocation = allocator.allocate_image(image.handle, requirements, &name.clone())?;
        let view_info = vk::ImageViewCreateInfo::default()
            .image(image.handle)
            .view_type(vk::ImageViewType::TYPE_2D)
            .format(format)
            .components(vk::ComponentMapping::default())
            .subresource_range(
                vk::ImageSubresourceRange::default()
                    .aspect_mask(aspect_flags)
                    .base_mip_level(0)
                    .level_count(1)
                    .base_array_layer(0)
                    .layer_count(1),
            );
        let view = unsafe { device.handle.create_image_view(&view_info, None) }?;
        let device = device.clone();
        Ok(Self {
            image,
            allocator,
            allocation,
            device,
            sampler,
            view,
        })
    }

    pub fn upload<T: Pod>(&self, cmd: &CommandBuffer, data: &[T]) -> Result<()> {
        let buffer = Buffer::from_data(
            &self.device,
            Arc::clone(&self.allocator),
            data,
            BufferUsageFlags::TRANSFER_SRC,
            MemoryLocation::GpuToCpu,
            format!("{}-staging", &self.image.name),
        )?;
        buffer.write(data);
        cmd.copy_buffer_to_image(&buffer, self);

        Ok(())
    }
}

impl Drop for AllocatedTexture {
    fn drop(&mut self) {
        unsafe {
            let allocation = std::mem::take(&mut self.allocation);
            self.allocator.deallocate(allocation);
            self.device.handle.destroy_image(self.image.handle, None);
        }
    }
}

#[derive(Clone, Debug)]
pub struct WrappedTexture {
    image: Image,
    view: vk::ImageView,
}

impl WrappedTexture {
    pub fn new(
        handle: vk::Image,
        view: vk::ImageView,
        extent: Extent2D,
        format: vk::Format,
        name: impl Into<String>,
    ) -> Result<Self> {
        let image = Image {
            handle,
            extent,
            format,
            name: name.into(),
            sampler: None,
        };

        Ok(Self { image, view })
    }
}
impl_image!(WrappedTexture);

#[derive(Clone, Debug)]
struct Image {
    handle: vk::Image,
    extent: Extent2D,
    format: Format,
    name: String,
    sampler: Option<vk::Sampler>,
}

impl Image {
    pub fn new(
        device: Device,
        extent: Extent2D,
        format: Format,
        usage: ImageUsageFlags,
        name: impl Into<String>,
        sampler: Option<vk::Sampler>,
    ) -> Result<Self> {
        let name = name.into();
        let image_info = &vk::ImageCreateInfo::default()
            .image_type(vk::ImageType::TYPE_2D)
            .format(format)
            .extent(extent.into())
            .mip_levels(1)
            .array_layers(1)
            .samples(vk::SampleCountFlags::TYPE_1)
            .tiling(vk::ImageTiling::OPTIMAL)
            .usage(usage | vk::ImageUsageFlags::TRANSFER_DST);
        let handle = unsafe { device.handle.create_image(image_info, None) }?;

        Ok(Self {
            handle,
            extent,
            format,
            name,
            sampler,
        })
    }
}

#[derive(Debug)]
pub enum ImageAllocation {
    Internal {
        allocator: Arc<Allocator>,
        allocation: Allocation,
    },
    External,
}
