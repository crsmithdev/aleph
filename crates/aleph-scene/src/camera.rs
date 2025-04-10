use {
    crate::vk::Extent2D,
    core::f32,
    glam::{vec2, Mat4, Vec2, Vec3},
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
            rotation: vec2(0., 0.), //vec2(-f32::consts::PI / 4.0, -f32::consts::PI / 4.0),
            distance: 3.,
            fov: 75.,
            z_near: 0.1,
            z_far: 100.,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Camera {
    distance: f32,
    target: Vec3,
    yaw: f32,
    pitch: f32,
    aspect_ratio: f32,
    config: CameraConfig,
}

impl Camera {
    pub fn new(config: CameraConfig, extent: Extent2D) -> Self {
        let yaw = config.rotation.x.to_radians();
        let pitch = config.rotation.y.to_radians();
        let aspect_ratio: f32 = extent.width as f32 / extent.height as f32;
        let distance = config.distance;
        let target = Vec3::ZERO;

        Self {
            distance,
            pitch,
            yaw,
            target,
            aspect_ratio,
            config,
        }
    }

    pub fn projection(&self) -> Mat4 {
        let perspective_rh = Mat4::perspective_rh(
            self.config.fov.to_radians(),
            self.aspect_ratio,
            self.config.z_near,
            self.config.z_far,
        );
        perspective_rh
    }

    pub fn view(&self) -> Mat4 {
        let view_rh = Mat4::look_at_rh(self.position(), self.target, Vec3::Y);
        view_rh
    }

    pub fn view_projection(&self) -> Mat4 { self.projection() * self.view() }

    pub fn model_view_projection(&self, model: &Mat4) -> Mat4 { self.view_projection() * *model }

    pub fn position(&self) -> Vec3 {
        let position = Vec3::new(
            self.distance * self.yaw.sin() * self.pitch.cos(),
            self.distance * self.pitch.sin(),
            self.distance * self.yaw.cos() * self.pitch.cos(),
        );

        position
    }

    pub fn rotate(&mut self, delta: Vec2) {
        self.yaw += delta.x;
        self.pitch += delta.y;
    }

    pub fn translate(&mut self, delta: Vec3) { self.target += delta; }

    pub fn zoom(&mut self, delta: f32) { self.distance += delta; }
}
