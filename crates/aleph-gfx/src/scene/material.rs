use {
    crate::vk::Texture,
    ash::vk::{self},
    derive_more::derive::Debug,
    glam::{vec4, Vec4},
    std::mem,
};

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
    pub name: String,
    #[debug("{:?}", base_color_tx.extent())]
    pub base_color_tx: Texture,
    pub base_color_factor: Vec4,
    pub base_color_sampler: vk::Sampler,
    #[debug("{:?}", normal_tx.extent())]
    pub normal_tx: Texture,
    pub normal_sampler: vk::Sampler,
    #[debug("{:?}", metallic_roughness_tx.extent())]
    pub metallic_roughness_tx: Texture,
    pub metallic_roughness_sampler: vk::Sampler,
    pub metallic_factor: f32,
    pub roughness_factor: f32,
    #[debug("{:?}", occlusion_tx.extent())]
    pub occlusion_tx: Texture,
    pub occlusion_sampler: vk::Sampler,
}
