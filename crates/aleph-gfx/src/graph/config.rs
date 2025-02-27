use {
    glam::{vec2, vec3, vec4, Vec2, Vec3, Vec4},
    std::f32,
};

pub struct RenderConfig {
    pub clear_color: Vec3,
    pub clear_normal: Vec4,
    pub clear_depth: f32,
    pub clear_stencil: u32,
    pub camera: CameraConfig,
}

impl Default for RenderConfig {
    fn default() -> Self {
        Self {
            clear_color: vec3(0.0, 0.0, 0.0),
            clear_normal: vec4(0., 0., 0., 0.),
            clear_depth: 1.0,
            clear_stencil: 0,
            camera: CameraConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct CameraConfig {
    pub distance: f32,
    pub rotation: Vec2,
    pub fov: f32,
    pub z_near: f32,
    pub z_far: f32,
}

impl Default for CameraConfig {
    fn default() -> Self {
        Self {
            rotation: vec2(-f32::consts::PI / 4.0, -f32::consts::PI / 4.0),
            distance: 2.0,
            fov: 90.,
            z_near: 0.1,
            z_far: 100.,
        }
    }
}
