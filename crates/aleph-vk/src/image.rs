use {
    crate::{allocator::AllocationHandle, Allocator, Device, Extent2D, Gpu},
    anyhow::Result,
    ash::vk::{
        ComponentMapping, Filter, Format, Handle, Image as VkImage, ImageAspectFlags,
        ImageCreateInfo, ImageSubresourceRange, ImageTiling, ImageType, ImageUsageFlags, ImageView,
        ImageViewCreateInfo, ImageViewType, SampleCountFlags, Sampler as VkSampler,
        SamplerAddressMode, SamplerCreateInfo, SamplerMipmapMode,
    },
    derive_more::{Debug, Deref},
    gpu_allocator::vulkan::Allocation,
    std::{mem, sync::Arc},
};

#[derive(Clone, Debug)]
pub struct TextureInfo {
    pub name: String,
    pub extent: Extent2D,
    pub format: Format,
    pub flags: ImageUsageFlags,
    pub aspect_flags: ImageAspectFlags,
    pub sampler: Option<crate::Sampler>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deref)]
#[debug("{image:?}")]
pub struct Texture {
    #[deref]
    image: Image,
    allocation: AllocationHandle,
    allocator: Arc<Allocator>,
    sampler: Option<Sampler>,
}

impl Texture {
    pub fn new(gpu: &Gpu, info: &TextureInfo) -> Result<Self> {
        let image_info = &ImageCreateInfo::default()
            .image_type(ImageType::TYPE_2D)
            .format(info.format)
            .extent(info.extent.into())
            .mip_levels(1)
            .array_layers(1)
            .samples(SampleCountFlags::TYPE_1)
            .tiling(ImageTiling::OPTIMAL)
            .usage(info.flags | ImageUsageFlags::TRANSFER_DST);
        let image = unsafe { gpu.device().handle.create_image(image_info, None) }?;
        let requirements = unsafe { gpu.device().handle.get_image_memory_requirements(image) };
        let allocation = gpu.allocator().allocate_image(image, requirements, &info.name)?;

        let handle = Image::new(
            image,
            gpu.device().clone(),
            info.extent,
            info.format,
            info.flags,
            info.aspect_flags,
            &info.name,
        )?;

        Ok(Self {
            image: handle,
            allocator: gpu.allocator().clone(),
            allocation,
            sampler: info.sampler.clone(),
        })
    }

    pub fn name(&self) -> &str { &self.image.name }

    pub fn handle(&self) -> VkImage { self.image.handle }

    pub fn view(&self) -> ImageView { self.image.view }

    pub fn sampler(&self) -> Option<crate::Sampler> { self.sampler.clone() }

    pub fn format(&self) -> Format { self.image.format }

    pub fn aspect_flags(&self) -> ImageAspectFlags { self.image.aspect_flags }
}

impl Drop for Texture {
    fn drop(&mut self) {
        self.allocator.deallocate_image(self.allocation);
        self.image.destroy();
    }
}
#[derive(Clone, Debug)]
pub struct Image {
    name: String,
    #[debug("{:#x}", handle.as_raw())]
    handle: VkImage,
    #[debug("{:#x}", view.as_raw())]
    view: ImageView,
    #[debug("{}x{}", extent.width, extent.height)]
    extent: Extent2D,
    format: Format,
    usage_flags: ImageUsageFlags,
    aspect_flags: ImageAspectFlags,
    #[debug(skip)]
    device: Device,
}

impl Image {
    pub fn new(
        handle: VkImage,
        device: Device,
        extent: Extent2D,
        format: Format,
        usage_flags: ImageUsageFlags,
        aspect_flags: ImageAspectFlags,
        name: &str,
    ) -> Result<Self> {
        let view_info = ImageViewCreateInfo::default()
            .image(handle)
            .view_type(ImageViewType::TYPE_2D)
            .format(format)
            .components(ComponentMapping::default())
            .subresource_range(
                ImageSubresourceRange::default()
                    .aspect_mask(aspect_flags)
                    .base_mip_level(0)
                    .level_count(1)
                    .base_array_layer(0)
                    .layer_count(1),
            );
        let view = unsafe { device.handle.create_image_view(&view_info, None) }?;
        let name = name.to_string();

        let image = Self {
            name,
            format,
            handle,
            view,
            extent,
            usage_flags,
            aspect_flags,
            device: device.clone(),
        };

        log::trace!("Created {:?}", image);
        Ok(image)
    }

    pub fn handle(&self) -> VkImage { self.handle }

    pub fn view(&self) -> ImageView { self.view }

    pub fn extent(&self) -> Extent2D { self.extent }

    pub fn format(&self) -> Format { self.format }

    pub fn usage_flags(&self) -> ImageUsageFlags { self.usage_flags }

    pub fn aspect_flags(&self) -> ImageAspectFlags { self.aspect_flags }

    pub fn destroy(&self) {
        unsafe {
            self.device.handle.destroy_image_view(self.view, None);
            self.device.handle.destroy_image(self.handle, None);
        }
    }
}

#[cfg(test)]
mod tests {
    use {super::*, crate::test::test_gpu};
    #[test]
    #[cfg(feature = "gpu-tests")]
    fn test_create_texture() {
        let gpu = test_gpu();
        let texture = Texture::new(
            &gpu,
            &TextureInfo {
                name: "test".to_string(),
                extent: Extent2D {
                    width: 1024,
                    height: 1024,
                },
                format: Format::R8G8B8A8_SRGB,
                flags: ImageUsageFlags::TRANSFER_DST,
                aspect_flags: ImageAspectFlags::COLOR,
                sampler: None,
            },
        )
        .unwrap();

        assert_eq!(texture.name(), "test");
        assert_eq!(texture.extent().width, 1024);
        assert_eq!(texture.extent().height, 1024);
        assert_eq!(texture.format(), Format::R8G8B8A8_SRGB);
        assert_eq!(texture.aspect_flags(), ImageAspectFlags::COLOR);
        assert_eq!(texture.usage_flags(), ImageUsageFlags::TRANSFER_DST);
        assert!(texture.handle() != VkImage::null());
        assert!(texture.view() != ImageView::null());
    }
    #[test]
    #[cfg(feature = "gpu-tests")]
    fn test_sampler_new() {
        let gpu = test_gpu();
        let device = gpu.device();
        let sampler = Sampler::new(
            &device,
            Filter::NEAREST,
            Filter::LINEAR,
            SamplerMipmapMode::NEAREST,
            SamplerAddressMode::CLAMP_TO_EDGE,
            SamplerAddressMode::MIRRORED_REPEAT,
            "sampler_test",
        )
        .unwrap();

        assert_eq!(sampler.name(), "sampler_test");
        assert_eq!(sampler.min_filter(), Filter::NEAREST);
        assert_eq!(sampler.mag_filter(), Filter::LINEAR);
        assert_eq!(sampler.mipmap_mode(), SamplerMipmapMode::NEAREST);
        assert_eq!(sampler.address_mode_u(), SamplerAddressMode::CLAMP_TO_EDGE);
        assert_eq!(
            sampler.address_mode_v(),
            SamplerAddressMode::MIRRORED_REPEAT
        );
        assert!(sampler.handle() != VkSampler::null());
    }
    #[test]
    #[cfg(feature = "gpu-tests")]
    fn test_sampler_default() {
        let gpu = test_gpu();
        let device = gpu.device();
        let sampler = Sampler::default(&device).unwrap();

        assert_eq!(sampler.name(), "default");
        assert_eq!(sampler.min_filter(), Filter::LINEAR);
        assert_eq!(sampler.mag_filter(), Filter::LINEAR);
        assert_eq!(sampler.mipmap_mode(), SamplerMipmapMode::LINEAR);
        assert_eq!(sampler.address_mode_u(), SamplerAddressMode::REPEAT);
        assert_eq!(sampler.address_mode_v(), SamplerAddressMode::REPEAT);
        assert!(sampler.handle() != VkSampler::null());
    }
}

#[derive(Clone, Debug, Deref)]
pub struct Sampler {
    name: String,
    #[deref]
    handle: VkSampler,
    min_filter: Filter,
    mag_filter: Filter,
    mipmap_mode: SamplerMipmapMode,
    address_mode_u: SamplerAddressMode,
    address_mode_v: SamplerAddressMode,
}

impl Sampler {
    pub fn new(
        device: &Device,
        min_filter: Filter,
        mag_filter: Filter,
        mipmap_mode: SamplerMipmapMode,
        address_mode_u: SamplerAddressMode,
        address_mode_v: SamplerAddressMode,
        name: &str,
    ) -> Result<Self> {
        let create_info = SamplerCreateInfo::default()
            .mag_filter(min_filter)
            .min_filter(mag_filter)
            .address_mode_u(address_mode_u)
            .address_mode_v(address_mode_v)
            .mipmap_mode(mipmap_mode);

        let handle = unsafe { device.handle.create_sampler(&create_info, None)? };
        let name = name.to_string();

        let sampler = Self {
            name,
            handle,
            min_filter,
            mag_filter,
            mipmap_mode,
            address_mode_u,
            address_mode_v,
        };

        log::trace!("Created {sampler:?}");
        Ok(sampler)
    }

    pub fn default(device: &crate::Device) -> Result<Self> {
        Self::new(
            device,
            Filter::LINEAR,
            Filter::LINEAR,
            SamplerMipmapMode::LINEAR,
            SamplerAddressMode::REPEAT,
            SamplerAddressMode::REPEAT,
            "default",
        )
    }

    pub fn name(&self) -> &str { &self.name }

    pub fn handle(&self) -> VkSampler { self.handle }

    pub fn min_filter(&self) -> Filter { self.min_filter }

    pub fn mag_filter(&self) -> Filter { self.mag_filter }

    pub fn mipmap_mode(&self) -> SamplerMipmapMode { self.mipmap_mode }

    pub fn address_mode_u(&self) -> SamplerAddressMode { self.address_mode_u }

    pub fn address_mode_v(&self) -> SamplerAddressMode { self.address_mode_v }
}
