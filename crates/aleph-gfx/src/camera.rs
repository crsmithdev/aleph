use {
    crate::vk::Extent2D,
    glam::{vec2, vec3, Mat4, Vec2, Vec3},
};

const FOV_DEGREES: f32 = 75.;
const Z_NEAR: f32 = 0.1;
const Z_FAR: f32 = 100.;

pub struct CameraConfig {
    pub position: Vec3,
    pub rotation: Vec2,
    pub fov_degrees: f32,
    pub z_near: f32,
    pub z_far: f32,
}

impl Default for CameraConfig {
    fn default() -> Self {
        Self {
            position: vec3(0.0, 0.0, 2.0),
            rotation: vec2(0.0, 0.0),
            fov_degrees: FOV_DEGREES,
            z_near: Z_NEAR,
            z_far: Z_FAR,
        }
    }
}

pub struct Camera {
    pub position: Vec3,
    pub rotation_yaw: f32,
    pub rotation_pitch: f32,
    pub view_matrix: Mat4,
    pub perspective_matrix: Mat4,
}

impl Camera {
    pub fn new(config: CameraConfig, extent: Extent2D) -> Self {
        let position = config.position;
        let rotation_yaw = config.rotation.x.to_radians();
        let rotation_pitch = config.rotation.y.to_radians();
        let aspect_ratio: f32 = extent.width as f32 / extent.height as f32;
        let view_matrix = Self::calc_view_matrix(position, rotation_yaw, rotation_pitch);
        let perspective_matrix = Mat4::perspective_rh(
            config.fov_degrees.to_radians(),
            aspect_ratio,
            config.z_near,
            config.z_far,
        );

        Self {
            position,
            rotation_pitch,
            rotation_yaw,
            view_matrix,
            perspective_matrix,
        }
    }

    pub fn position(&self) -> Vec3 {
        self.position
    }

    pub fn view_matrix(&self) -> &Mat4 {
        &self.view_matrix
    }

    pub fn perspective_matrix(&self) -> &Mat4 {
        &self.perspective_matrix
    }

    #[allow(dead_code)]
    pub fn view_projection_matrix(&self) -> Mat4 {
        let view = self.view_matrix();
        let perspective = self.perspective_matrix();
        perspective.mul_mat4(view)
    }

    pub fn model_view_projection_matrix(&self, model: Mat4) -> Mat4 {
        let view = self.view_matrix();
        let perspective = self.perspective_matrix();
        Self::calc_model_view_projection_matrix(&model, view, perspective)
    }

    pub fn calc_model_view_projection_matrix(
        model_matrix: &Mat4,
        view_matrix: &Mat4,
        projection_matrix: &Mat4,
    ) -> Mat4 {
        projection_matrix
            .mul_mat4(view_matrix)
            .mul_mat4(model_matrix)
    }

    fn calc_view_matrix(position: Vec3, yaw: f32, pitch: f32) -> Mat4 {
        let rotation = Self::calc_rotation_matrix(yaw, pitch);
        let translation = Mat4::from_translation(-position);
        rotation * translation
    }

    fn calc_rotation_matrix(yaw: f32, pitch: f32) -> Mat4 {
        let pitch = Mat4::from_rotation_x(pitch);
        let yaw = Mat4::from_rotation_y(yaw);
        pitch * yaw
    }
}
