use {
    aleph_hal::Extent2D,
    nalgebra::{Matrix4, Perspective3, Rotation3, Vector2, Vector3},
};

const FOV_DEGREES: f32 = 75.;
const Z_NEAR: f32 = 0.1;
const Z_FAR: f32 = 100.;

pub struct Camera {
    pub position: Vector3<f32>,
    pub rotation: Vector2<f32>,
    pub view_matrix: Matrix4<f32>,
    pub perspective_matrix: Matrix4<f32>,
    pub z_near: f32,
    pub z_far: f32,
}
     
impl Camera {
    pub fn new(extent: Extent2D) -> Self {
        let position = Vector3::new(0., 0., 2.);
        let aspect_ratio = extent.width as f32 / extent.height as f32;
        let rotation = Vector2::new(0., 0.);
        let view_matrix = Self::calucate_view_matrix(position, rotation);
        let perspective_matrix =
            Self::calculate_perspective_matrix(FOV_DEGREES, aspect_ratio, Z_NEAR, Z_FAR);
        Self {
            position,
            rotation,
            view_matrix,
            perspective_matrix,
            z_near: Z_NEAR,
            z_far: Z_FAR,
        }
    }

    pub fn position(&self) -> Vector3<f32> {
        self.position
    }

    pub fn view_matrix(&self) -> Matrix4<f32> {
        self.view_matrix
    }

    pub fn perspective_matrix(&self) -> Matrix4<f32> {
        self.perspective_matrix
    }

    pub fn view_projection_matrix(&self) -> Matrix4<f32> {
        self.perspective_matrix * self.view_matrix
    }

    pub fn model_view_projection_matrix(&self, model_matrix: Matrix4<f32>) -> Matrix4<f32> {
        self.view_matrix * self.perspective_matrix * model_matrix
    }

    fn calucate_view_matrix(position: Vector3<f32>, rotation: Vector2<f32>) -> Matrix4<f32> {
        let rotation_matrix = Self::calculate_rotation_matrix(rotation.x, rotation.y);
        let translation_matrix = Matrix4::new_translation(&-position);
        rotation_matrix * translation_matrix
    }

    fn calculate_rotation_matrix(yaw: f32, pitch: f32) -> Matrix4<f32> {
        let yaw = Self::to_radians(yaw);
        let pitch = Self::to_radians(pitch);
        let pitch_matrix = Rotation3::from_axis_angle(&Vector3::x_axis(), pitch);
        let yaw_matrix = Rotation3::from_axis_angle(&Vector3::y_axis(), yaw);

        let rotation = pitch_matrix * yaw_matrix;
        rotation.to_homogeneous()
    }

    fn calculate_perspective_matrix(
        fov: f32,
        aspect_ratio: f32,
        z_near: f32,
        z_far: f32,
    ) -> Matrix4<f32> {
        Perspective3::new(Self::to_radians(fov), aspect_ratio, z_near, z_far).into_inner()
    }

    fn to_radians(degrees: f32) -> f32 {
        degrees * (std::f32::consts::PI / 180.0)
    }
}
