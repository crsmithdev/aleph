use {
    crate::{Allocator, Device, Extent2D, Format, Gpu, ImageAspectFlags, ImageUsageFlags},
    anyhow::Result,
    ash::vk::{self, Handle},
    derive_more::{Debug, Deref},
    gpu_allocator::vulkan::Allocation,
    std::{mem, rc::Rc, sync::Arc},
};

#[derive(Clone)]
pub struct TextureInfo {
    pub name: String,
    pub extent: Extent2D,
    pub format: Format,
    pub flags: ImageUsageFlags,
    pub aspect_flags: ImageAspectFlags,
    pub data: Vec<u8>,
    pub sampler: Option<vk::Sampler>,
}

#[derive(Debug)]
pub struct TextureInfo2 {
    pub name: String,
    #[debug("{}x{}", extent.width, extent.height)]
    pub extent: Extent2D,
    pub format: Format,
    pub flags: ImageUsageFlags,
    pub aspect_flags: ImageAspectFlags,
    #[debug("{:#x}", sampler.map(|s| s.as_raw()).unwrap_or(0))]
    pub sampler: Option<vk::Sampler>,
}

impl Debug for TextureInfo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let data_len = self.data.len();
        write!(
            f,
            "TextureInfo(name: {}, extent: {}x{}, format: {:?}, usage: {:?}, aspect: {:?}, data: {}b)",
            self.name, self.extent.width, self.extent.height, self.format, self.flags, self.aspect_flags, data_len,
        )
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deref)]
#[debug("{image:?}")]
pub struct Texture {
    #[deref]
    image: Image,
    allocation: Rc<Allocation>,
    allocator: Arc<Allocator>,
    device: Device,
    sampler: Option<vk::Sampler>,
}

impl Texture {
    pub fn new(gpu: &Gpu, info: &TextureInfo) -> Result<Self> {
        let device = gpu.device.clone();
        let allocator = gpu.allocator.clone();

        let image_info = &vk::ImageCreateInfo::default()
            .image_type(vk::ImageType::TYPE_2D)
            .format(info.format)
            .extent(info.extent.into())
            .mip_levels(1)
            .array_layers(1)
            .samples(vk::SampleCountFlags::TYPE_1)
            .tiling(vk::ImageTiling::OPTIMAL)
            .usage(info.flags | vk::ImageUsageFlags::TRANSFER_DST);
        let image = unsafe { device.handle.create_image(image_info, None) }?;
        let requirements = unsafe { device.handle.get_image_memory_requirements(image) };
        let allocation = Rc::new(allocator.allocate_image(image, requirements, &info.name)?);

        let handle = Image::new(
            image,
            device.clone(),
            info.extent,
            info.format,
            info.aspect_flags,
            &info.name,
        )?;

        let device = device.clone();

        Ok(Self {
            image: handle,
            allocator,
            allocation,
            device,
            sampler: info.sampler,
        })
    }

    pub fn new2(gpu: &Gpu, info: &TextureInfo2) -> Result<Self> {
        let name = info.name.to_string();
        let device = gpu.device.clone();
        let allocator = gpu.allocator.clone();

        let image_info = &vk::ImageCreateInfo::default()
            .image_type(vk::ImageType::TYPE_2D)
            .format(info.format)
            .extent(info.extent.into())
            .mip_levels(1)
            .array_layers(1)
            .samples(vk::SampleCountFlags::TYPE_1)
            .tiling(vk::ImageTiling::OPTIMAL)
            .usage(info.flags | vk::ImageUsageFlags::TRANSFER_DST);
        let image = unsafe { device.handle.create_image(image_info, None) }?;
        let requirements = unsafe { device.handle.get_image_memory_requirements(image) };
        let allocation = Rc::new(allocator.allocate_image(image, requirements, &name.clone())?);

        let handle = Image::new(
            image,
            device.clone(),
            info.extent,
            info.format,
            info.aspect_flags,
            &info.name,
        )?;

        let device = device.clone();

        Ok(Self {
            image: handle,
            allocator,
            allocation,
            device,
            sampler: info.sampler,
        })
    }

    pub fn name(&self) -> &str { &self.image.name }

    pub fn handle(&self) -> vk::Image { self.image.handle }

    pub fn view(&self) -> vk::ImageView { self.image.view }

    pub fn sampler(&self) -> Option<vk::Sampler> { self.sampler }

    pub fn aspect_flags(&self) -> ImageAspectFlags { self.image.aspect_flags }
}

impl Drop for Texture {
    fn drop(&mut self) {
        unsafe {
            let allocation = mem::replace(&mut self.allocation, Rc::new(Allocation::default()));
            if let Ok(allocation) = Rc::try_unwrap(allocation) {
                self.allocator.deallocate(allocation);
                self.device.handle.destroy_image(self.image.handle, None);
                self.device.handle.destroy_image_view(self.image.view, None);
            }
        }
    }
}

#[derive(Clone, Debug)]
pub struct Image {
    name: String,
    #[debug("{:#x}", handle.as_raw())]
    handle: vk::Image,
    #[debug("{:#x}", view.as_raw())]
    view: vk::ImageView,
    #[debug("{}x{}", extent.width, extent.height)]
    extent: Extent2D,
    format: Format,
    aspect_flags: ImageAspectFlags,
}

impl Image {
    pub fn new(
        handle: vk::Image,
        device: Device,
        extent: Extent2D,
        format: Format,
        aspect_flags: ImageAspectFlags,
        name: &str,
    ) -> Result<Self> {
        let view_info = vk::ImageViewCreateInfo::default()
            .image(handle)
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
        let name = name.to_string();

        let image = Self {
            name,
            format,
            handle,
            view,
            extent,
            aspect_flags,
        };

        log::trace!("Created {:?}", image);
        Ok(image)
    }

    pub fn handle(&self) -> vk::Image { self.handle }

    pub fn view(&self) -> vk::ImageView { self.view }

    pub fn extent(&self) -> Extent2D { self.extent }

    pub fn aspect_flags(&self) -> ImageAspectFlags { self.aspect_flags }
}

#[cfg(test)]
mod tests {
    use {super::*, crate::test::test_gpu};

    #[test]
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
                data: vec![0; 1024 * 1024 * 4],
                sampler: None,
            },
        );

        assert!(texture.is_ok());
    }
}
