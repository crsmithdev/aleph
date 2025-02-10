use {
    crate::vk::Extent2D,
    glam::{Vec2, vec3, vec2, Vec3, Mat4},
};

const FOV_DEGREES: f32 = 75.;
const Z_NEAR: f32 = 0.1;
const Z_FAR: f32 = 100.;

pub struct Camera {
    pub position: Vec3,
    pub rotation_yaw: f32,
    pub rotation_pitch: f32,
    pub view_matrix: Mat4,
    pub perspective_matrix: Mat4,
}

impl Camera {
    pub fn new(extent: Extent2D) -> Self {
        let position = vec3(0.0, 0.0, 2.0);
        let rotation = vec2(0., 0.0);
        let rotation_yaw = rotation.x.to_radians();
        let rotation_pitch = rotation.y.to_radians();
        let aspect_ratio: f32 = 1280.0 / 720.0;
        let view_matrix = Self::calc_view_matrix(position, rotation_yaw, rotation_pitch);
        let fov_dgr: f32 = 75.0;
        let z_near = 0.1;
        let z_far = 100.;
        let perspective_matrix = Mat4::perspective_rh(
            fov_dgr.to_radians(),
            aspect_ratio,
            z_near,
            z_far,
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
        self.position.clone()
    }

    pub fn view_matrix(&self) -> &Mat4 {
        &self.view_matrix
    }

    pub fn perspective_matrix(&self) -> &Mat4 {
        &self.perspective_matrix
    }

    #[allow(dead_code)]
    pub fn view_projection_matrix(&self) -> Mat4 {
        let v = self.view_matrix();
        let p = self.perspective_matrix();
        p.mul_mat4(&v)
    }

    pub fn model_view_projection_matrix(&self, model_matrix: Mat4) -> Mat4 {
        let v = self.view_matrix();
        let p = self.perspective_matrix();
        let m = model_matrix;
        Self::calc_model_view_projection_matrix(&m, v, p)
    }

    pub fn calc_model_view_projection_matrix(
        model_matrix: &Mat4,
        view_matrix: &Mat4,
        projection_matrix: &Mat4,
      ) -> Mat4 {
        projection_matrix
          .mul_mat4(&view_matrix)
          .mul_mat4(&model_matrix)
    }

    fn calc_view_matrix(position: Vec3, yaw: f32, pitch: f32) -> Mat4 {
        let mat_rot = Self::calc_rotation_matrix(yaw, pitch);

      // we have to reverse position, as moving camera X units
      // moves scene -X units
        let mat_tra = Mat4::from_translation(-position);

        mat_rot * mat_tra
    }

    fn calc_rotation_matrix(yaw: f32, pitch: f32) -> Mat4 {
        let mat_p = Mat4::from_rotation_x(pitch);
        let mat_y = Mat4::from_rotation_y(yaw);
        mat_p * mat_y
  }
}
