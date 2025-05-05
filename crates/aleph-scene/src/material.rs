use {
    crate::TextureHandle,
    derive_more::derive::Debug,
    glam::{vec4, Vec4},
};

#[derive(Debug, Clone)]
pub struct Material {
    pub name: String,
    pub color_texture: Option<TextureHandle>,
    pub color_factor: Vec4,
    pub normal_texture: Option<TextureHandle>,
    pub metalrough_texture: Option<TextureHandle>,
    pub metallic_factor: f32,
    pub roughness_factor: f32,
    pub ao_texture: Option<TextureHandle>,
    pub ao_strength: f32,
}

impl Default for Material {
    fn default() -> Self {
        Self {
            name: "default".to_string(),
            color_texture: None,
            color_factor: vec4(1., 1., 1., 1.),
            normal_texture: None,
            metalrough_texture: None,
            metallic_factor: 1.0,
            roughness_factor: 1.0,
            ao_texture: None,
            ao_strength: 1.0,
        }
    }
}
