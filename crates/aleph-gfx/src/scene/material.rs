use {
    crate::vk::Texture,
    ash::vk::{self},
    derive_more::derive::Debug,
    glam::{vec4, Vec4},
    std::{collections::HashMap, hash::Hash, mem, sync::atomic},
};

#[derive(Debug)]
pub struct AssetCache {
    counter: atomic::AtomicU64,
    materials: HashMap<AssetHandle, Material>,
}

impl Default for AssetCache {
    fn default() -> Self {
        Self {
            counter: atomic::AtomicU64::new(0),
            materials: HashMap::new(),
        }
    }
}

#[derive(PartialEq, Clone, Copy, Eq, Hash, Debug)]
pub struct AssetHandle {
    pub id: u64,
}

impl AssetCache {
    pub fn add_material(&mut self, material: Material) -> AssetHandle {
        let id = self.counter.fetch_add(1, atomic::Ordering::Relaxed);
        let handle = AssetHandle { id };
        self.materials.insert(handle, material);
        handle
    }

    pub fn get_material(&self, handle: AssetHandle) -> Option<&Material> {
        self.materials.get(&handle)
    }
}

#[inline]
#[allow(non_snake_case)]
pub fn packUnorm4x8(v: Vec4) -> u32 {
    let us = v.clamp(vec4(0., 0., 0., 0.), vec4(1., 1., 1., 1.)).round();
    let pack: [u8; 4] = [us.w as u8, us.z as u8, us.y as u8, us.x as u8];
    let r: &u32 = unsafe { mem::transmute(&pack) };
    *r
}

#[derive(Debug)]
pub struct Material {
    pub albedo_map: Texture,
    pub albedo_sampler: vk::Sampler,
    pub normal_map: Texture,
    pub normal_sampler: vk::Sampler,
    pub metallic_map: Texture,
    pub roughness_map: Texture,
    pub metallic_sampler: vk::Sampler,
    pub roughness_sampler: vk::Sampler,
    pub roughness_factor: f32,
    pub metallic_factor: f32,
    pub occlusion_map: Texture,
    pub occlusion_sampler: vk::Sampler,
}
