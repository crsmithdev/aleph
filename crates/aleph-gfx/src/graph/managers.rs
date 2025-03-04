use {
    crate::{
        graph::util,
        vk::{Gpu, Texture},
    },
    anyhow::Result,
    ash::vk::{self, Extent2D, Format, ImageAspectFlags, ImageUsageFlags},
    core::str,
    derive_more::derive::Debug,
    glam::{vec4, Vec4},
    std::{collections::HashMap, hash::Hash, mem },
};

#[derive(Default, Debug)]
pub struct AssetCache {
    textures: HashMap<String, Texture>,
    // counter: atomic::AtomicU64,
    materials: HashMap<String, Material>,
}

#[derive(Debug)]
pub struct Material {
    pub base_color_texture: Texture,
    pub normal_texture: Texture,
    pub metallic_texture: Texture,
    pub metallic_factor: f32,
    pub roughness_texture: Texture,
    pub roughness_factor: f32,
    pub occlusion_texture: Texture,
}

#[derive(PartialEq, Clone, Copy, Eq, Hash, Debug)]
pub struct AssetHandle {
    id: u64,
}

impl AssetCache {
    pub fn add_material(&mut self, key: String, material: Material) {
        // let id = self.counter.fetch_add(1, atomic::Ordering::Relaxed);
        // let handle = AssetHandle {id };
        self.materials.insert(key, material);
    }

    pub fn get_material(&self, handle: String) -> Option<&Material> {
        self.materials.get(&handle)
    }
    pub fn load_texture2(
        &mut self,
        gpu: &Gpu,
        path: impl Into<String>,
        name: impl Into<String>,
    ) -> Result<Texture> {
        let image = image::open(path.into())?;
        let image = image.to_rgba8();
    let data: &Vec<u8> = image.as_raw();
        let extent = Extent2D {
            width: image.width(),
            height: image.height(),
        };
        let format = Format::R16G16B16A16_UNORM;
        let bytes: Vec<u8> = bytemuck::cast_slice(data).to_vec();
         let name: String = name.into();
         let image = gpu.create_image(extent, format, ImageUsageFlags::SAMPLED, ImageAspectFlags::COLOR, name.clone())?;
         let staging = util::staging_buffer(gpu, &bytes, "texture staging")?;
         gpu.execute(|cmd| cmd.copy_buffer_to_image(&staging, &image))?;
        Ok(image)
    }

    pub fn load_texture(
        &mut self,
        gpu: &Gpu,
        path: impl Into<String>,
        name: impl Into<String>,
    ) -> Result<&Texture> {
        let image = image::open(path.into())?;
        let image = image.to_rgba16();
        let data = image.as_raw();
        let extent = Extent2D {
            width: image.width(),
            height: image.height(),
        };
        let format = Format::R16G16B16A16_UNORM;
        let bytes = bytemuck::cast_slice(data);
        let image = self.create_image(gpu, bytes, extent, format, name);
        image
    }

    pub fn create_image(
        &mut self,
        gpu: &Gpu,
        data: &[u8],
        extent: Extent2D,
        format: vk::Format,
        name: impl Into<String>,
    ) -> Result<&Texture> {
        let name: String = name.into();
        let image = gpu.create_image(extent, format, ImageUsageFlags::SAMPLED, ImageAspectFlags::COLOR, name.clone())?;
        let staging = util::staging_buffer(gpu, data, "texture staging")?;
        gpu.execute(|cmd| cmd.copy_buffer_to_image(&staging, &image))?;
        self.textures.insert(name.clone(), image);
        Ok(self.textures.get(&name).unwrap())
    }
    pub fn create_error_texture(&mut self, gpu: &Gpu) -> Result<&Texture> {
        let pixels = (0..256).map(|i| match i % 2 {
            0 => 0,
            _ => 4294902015u32,
        });
        let data: Vec<u8> = pixels.into_iter().flat_map(|i| i.to_le_bytes()).collect();
        let extent = Extent2D {
            width: 16,
            height: 16,
        };
        self.create_image(gpu, &data, extent, Format::R8G8B8A8_UNORM, "error")
    }

    pub fn create_single_color_image(
        &mut self,
        gpu: &Gpu,
        color: Vec4,
        name: impl Into<String>,
    ) -> Result<&Texture> {
        let data = [packUnorm4x8(color)];
        let extent = Extent2D {
            width: 1,
            height: 1,
        };
        let data = bytemuck::cast_slice(&data);
        self.create_image(gpu, data, extent, Format::R8G8B8A8_UNORM, name)
    }

    pub fn get_texture(&self, name: &str) -> Option<&Texture> { self.textures.get(name) }
}

#[inline]
#[allow(non_snake_case)]
pub fn packUnorm4x8(v: Vec4) -> u32 {
    let us = v.clamp(vec4(0., 0., 0., 0.), vec4(1., 1., 1., 1.)).round();
    let pack: [u8; 4] = [us.w as u8, us.z as u8, us.y as u8, us.x as u8];
    let r: &u32 = unsafe { mem::transmute(&pack) };
    *r
}
