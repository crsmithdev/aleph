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
    pub base_texture: Option<usize>,
    pub base_color: Vec4,
    pub color_sampler: Option<vk::Sampler>,
    pub normal_texture: Option<usize>,
    pub normal_sampler: Option<vk::Sampler>,
    pub metallic_roughness_texture: Option<usize>,
    pub metallic_roughness_sampler: Option<vk::Sampler>,
    pub metallic_factor: f32,
    pub roughness_factor: f32,
    pub occlusion_texture: Option<usize>,
    pub occlusion_sampler: Option<vk::Sampler>,
    pub occlusion_factor: f32,
}

impl Default for Material {
    fn default() -> Self {
        Self {
            name: "default".to_string(),
            base_texture: None,
            base_color: vec4(1., 1., 1., 1.),
            color_sampler: None,
            normal_texture: None,
            normal_sampler: None,
            metallic_roughness_texture: None,
            metallic_roughness_sampler: None,
            metallic_factor: 1.0,
            roughness_factor: 1.0,
            occlusion_texture: None,
            occlusion_sampler: None,
            occlusion_factor: 1.0,
        }
    }
}
