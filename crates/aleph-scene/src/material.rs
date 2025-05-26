use {
    crate::TextureHandle,
    derive_more::derive::Debug,
    glam::{vec4, Vec4},
};

#[derive(Debug, Clone)]
pub struct Material {
    pub name: String,
    pub color_texture: TextureHandle,
    pub color_factor: Vec4,
    pub normal_texture: TextureHandle,
    pub metalrough_texture: TextureHandle,
    pub metallic_factor: f32,
    pub roughness_factor: f32,
    pub occlusion_texture: TextureHandle,
    pub ao_strength: f32,
}

impl Default for Material {
    fn default() -> Self {
        Self {
            name: "default".to_string(),
            color_texture: TextureHandle::null(),
            color_factor: vec4(1., 1., 1., 1.),
            normal_texture: TextureHandle::null(),
            metalrough_texture: TextureHandle::null(),
            metallic_factor: 1.0,
            roughness_factor: 1.0,
            occlusion_texture: TextureHandle::null(),
            ao_strength: 1.0,
        }
    }
}

impl Material {
    pub fn fill(src: &Self, dst: &mut Self) {
        if dst.color_texture == TextureHandle::null() {
            dst.color_texture = src.color_texture;
        }
        if dst.normal_texture == TextureHandle::null() {
            dst.normal_texture = src.normal_texture;
        }
        if dst.metalrough_texture == TextureHandle::null() {
            dst.metalrough_texture = src.metalrough_texture;
        }
        if dst.occlusion_texture == TextureHandle::null() {
            dst.occlusion_texture = src.occlusion_texture;
        }

        dst.name = src.name.clone();
        dst.color_texture = src.color_texture.clone();
        dst.color_factor = src.color_factor;
        dst.normal_texture = src.normal_texture.clone();
        dst.metalrough_texture = src.metalrough_texture.clone();
        dst.metallic_factor = src.metallic_factor;
        dst.roughness_factor = src.roughness_factor;
        dst.occlusion_texture = src.occlusion_texture.clone();
        dst.ao_strength = src.ao_strength;
    }
}
