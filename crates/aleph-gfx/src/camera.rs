use nalgebra::{Matrix4, Vector3};

#[derive(Default)]
pub struct Camera {
    pub view_matrix: Matrix4<f32>,
    pub perspective_matrix: Matrix4<f32>,
    pub position: Vector3<f32>,
    pub rotation_yaw: f32,
    pub rotation_pitch: f32,
  }