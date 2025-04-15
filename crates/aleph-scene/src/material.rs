use {
    derive_more::derive::Debug,
    glam::{vec4, Vec4},
};

#[derive(Debug)]
pub struct Material {
    pub name: String,
    pub base_texture: Option<usize>,
    pub base_color: Vec4,
    pub normal_texture: Option<usize>,
    pub metallic_roughness_texture: Option<usize>,
    pub metallic_factor: f32,
    pub roughness_factor: f32,
    pub ao_texture: Option<usize>,
    pub ao_strength: f32,
}

impl Default for Material {
    fn default() -> Self {
        Self {
            name: "default".to_string(),
            base_texture: None,
            base_color: vec4(1., 1., 1., 1.),
            normal_texture: None,
            metallic_roughness_texture: None,
            metallic_factor: 1.0,
            roughness_factor: 1.0,
            ao_texture: None,
            ao_strength: 1.0,
        }
    }
}
