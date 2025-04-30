use {
    crate::{
        model::{Vertex, VertexAttribute},
        MeshInfo,
    },
    glam::{vec3, Vec3, Vec4},
};

pub fn cube(x: f32, y: f32, z: f32, color: [f32; 4]) -> MeshInfo {
    let positions = vec![
        vec3(-0.5, -0.5, 0.5),
        vec3(-0.5, 0.5, 0.5),
        vec3(0.5, 0.5, 0.5),
        vec3(0.5, -0.5, 0.5),
        vec3(-0.5, -0.5, -0.5),
        vec3(-0.5, 0.5, -0.5),
        vec3(0.5, 0.5, -0.5),
        vec3(0.5, -0.5, -0.5),
    ];
    let indices = vec![
        1, 0, 3, 3, 2, 1, 2, 3, 7, 7, 6, 2, 3, 0, 4, 4, 7, 3, 6, 2, 1, 1, 5, 6, 4, 5, 6, 6, 7, 4,
        5, 4, 0, 0, 1, 5,
    ];
    let vertices: Vec<Vertex> = positions
        .iter()
        .map(|p| Vertex {
            position: Vec3::new(p[0] * x as f32, p[1] * y as f32, p[2] * z as f32),
            uv_x: 0.,
            normal: Vec3::ZERO,
            uv_y: 0.,
            tangent: Vec4::ZERO,
            color: color.into(),
        })
        .collect();

    MeshInfo::new(
        indices,
        vertices,
        None,
        vec![VertexAttribute::Position],
        "cube",
    )
}
