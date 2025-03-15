use {
    crate::vk::Extent2D,
    core::f32,
    glam::{Mat4, vec2, Vec3, Vec2},
    
};

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
            distance: 2.,
            fov: 90.,
            z_near: 0.1,
            z_far: 100.,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Camera {
    distance: f32,
    target: Vec3,
    rotation_yaw: f32,
    rotation_pitch: f32,
    aspect_ratio: f32,
    config: CameraConfig,
    _pc: Vec3,
}

impl Camera {
    pub fn new(config: CameraConfig, extent: Extent2D) -> Self {
        let rotation_yaw = config.rotation.x.to_radians();
        let rotation_pitch = config.rotation.y.to_radians();
        let aspect_ratio: f32 = extent.width as f32 / extent.height as f32;
        let distance = config.distance;
        let target = Vec3::ZERO;

        Self {
            distance,
            rotation_pitch,
            rotation_yaw,
            target,
            aspect_ratio,
            config,
            _pc: Vec3::ZERO,
        }
    }

    pub fn projection(&self) -> Mat4 {
        Mat4::perspective_rh(
            self.config.fov.to_radians(),
            self.aspect_ratio,
            self.config.z_near,
            self.config.z_far,
        )
    }

    pub fn view(&self) -> Mat4 { Mat4::look_at_rh(self.position(), self.target, Vec3::Y) }

    pub fn view_projection(&self) -> Mat4 { self.projection() * self.view() }

    pub fn model_view_projection(&self, model: &Mat4) -> Mat4 { self.view_projection() * *model }

    pub fn rotate(&mut self, delta: f32) {
        self.rotation_yaw += delta;
        self._pc = self.position();
    }

    pub fn zoom(&mut self, delta: f32) { self.distance += delta; }

    pub fn position(&self) -> Vec3 {
        let yaw = self.rotation_yaw;
        let pitch = self.rotation_pitch;

        Vec3::new(
            self.distance * yaw.sin() * pitch.cos(),
            self.distance * pitch.sin(),
            self.distance * yaw.cos() * pitch.cos(),
        )
    }
}
