use {
    crate::TextureHandle,
    derive_more::Debug,
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
    pub occlusion_strength: f32,
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
            occlusion_strength: 1.0,
        }
    }
}
