use {
    crate::{mikktspace::MikktGeometry, MaterialHandle},
    aleph_vk::{Format, PrimitiveTopology},
    bytemuck::{Pod, Zeroable},
    derive_more::Debug,
    glam::{Vec2, Vec3, Vec4},
};

#[repr(C)]
#[derive(Copy, Clone, Debug, Default, Pod, Zeroable)]
pub struct Vertex {
    pub position: Vec3,
    pub uv_x: f32,
    pub normal: Vec3,
    pub uv_y: f32,
    pub tangent: Vec4,
    pub color: Vec4,
}

impl Vertex {
    pub fn binding_attributes() -> [(u32, Format); 6] {
        [
            (0, Format::R32G32B32_SFLOAT),     // position (3x f32 = 12 bytes)
            (12, Format::R32_SFLOAT),          // padding (1x f32 = 4 bytes)
            (16, Format::R32G32B32_SFLOAT),    // normal (3x f32 = 12 bytes)
            (28, Format::R32_SFLOAT),          // padding (1x f32 = 4 bytes)
            (32, Format::R32G32B32A32_SFLOAT), // tangent (4x f32 = 16 bytes)
            (48, Format::R32G32B32A32_SFLOAT), // color (4x f32 = 16 bytes)
        ]
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct MeshInfo {
    pub name: String,
    #[debug("{}", vertices.len())]
    pub vertices: Vec<Vec3>,
    #[debug("{}", indices.len())]
    pub indices: Vec<u32>,
    #[debug("{}", indices.len())]
    pub normals: Vec<Vec3>,
    #[debug("{}", tangents.len())]
    pub tangents: Vec<Vec4>,
    #[debug("{}", colors.len())]
    pub colors: Vec<Vec4>,
    #[debug("{}", tex_coords0.len())]
    pub tex_coords0: Vec<Vec2>,
    pub material: MaterialHandle,
    pub topology: PrimitiveTopology,
    // pub attributes: Vec<VertexAttribute>,
}
impl MeshInfo {
    pub fn name(mut self, name: &str) -> Self {
        self.name = name.to_string();
        self
    }

    pub fn vertices(mut self, vertices: Vec<Vec3>) -> Self {
        self.vertices = vertices;
        self
    }

    pub fn indices(mut self, indices: Vec<u32>) -> Self {
        self.indices = indices;
        self
    }

    pub fn normals(mut self, normals: Vec<Vec3>) -> Self {
        self.normals = normals;
        self
    }

    pub fn tangents(mut self, tangents: Vec<Vec4>) -> Self {
        self.tangents = tangents;
        self
    }

    pub fn tex_coords0(mut self, tex_coords0: Vec<Vec2>) -> Self {
        self.tex_coords0 = tex_coords0;
        self
    }

    pub fn material(mut self, material: MaterialHandle) -> Self {
        self.material = material;
        self
    }

    pub fn topology(mut self, topology: PrimitiveTopology) -> Self {
        self.topology = topology;
        self
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum VertexAttribute {
    Position,
    Normal,
    TexCoord0,
    Tangent,
    Color,
}

impl MikktGeometry for MeshInfo {
    fn num_faces(&self) -> usize { self.indices.len() / 3 }

    fn num_vertices_of_face(&self, _face: usize) -> usize { 3 }

    fn position(&self, face: usize, vert: usize) -> [f32; 3] {
        let i = self.indices[face * 3 + vert] as usize;
        self.vertices[i].into()
    }

    fn normal(&self, face: usize, vert: usize) -> [f32; 3] {
        let i = self.indices[face * 3 + vert] as usize;
        self.normals[i].into()
    }

    fn tex_coord(&self, face: usize, vert: usize) -> [f32; 2] {
        let i = self.indices[face * 3 + vert] as usize;
        self.tex_coords0[i].into()
    }

    fn set_tangent_encoded(&mut self, tangent: [f32; 4], face: usize, vert: usize) {
        let i = self.indices[face * 3 + vert] as usize;
        self.tangents[i] = Vec4::from(tangent);
    }
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct Light {
    pub position: Vec3,
    pub intensity: f32,
    pub color: Vec4,
}

impl Default for Light {
    fn default() -> Self {
        Self {
            position: Vec3::new(3.0, 3.0, 3.0),
            intensity: 10.0,
            color: Vec4::new(5.0, 5.0, 5.0, 1.0),
        }
    }
}

// #[cfg(test)]
// mod tests {
//     use super::*;

//     #[test]
//     fn test_generate_faces() {
//         let vertices = vec![
//             Vec3::new(0.0, 0.0, 0.0),
//             Vec3::new(1.0, 0.0, 0.0),
//             Vec3::new(0.0, 1.0, 0.0),
//         ];
//         let indices = vec![0, 1, 2, 1, 2, 0, 2, 0, 1];
//         calculate_faces(&indices, &vertices);
//     }
// }

// fn calculate_faces(indices: &Vec<u32>, vertices: &Vec<Vec3>) -> Vec<Face> {
//     indices
//         .chunks_exact(3)
//         .map(|idxs| {
//             let a = vertices[idxs[0] as usize];
//             let b = vertices[idxs[1] as usize];
//             let c = vertices[idxs[2] as usize];
//             let ba = (b - a).normalize();
//             let ca = (c - a).normalize();
//             let n = ba.cross(ca).normalize();

//             Face {
//                 indices: Vec3::new(idxs[0] as f32, idxs[1] as f32, idxs[2] as f32),
//                 normal: n,
//             }
//         })
//         .collect()
// }

// fn calculate_normals(vertices: &Vec<Vec3>, indices: &Vec<u32>) -> Vec<Vec3> {
//     let mut normals = vec![glam::Vec3::ZERO; vertices.len()];

//     for i in (0..indices.len()).step_by(3) {
//         let a = vertices[indices[i] as usize];
//         let b = vertices[indices[i + 1] as usize];
//         let c = vertices[indices[i + 2] as usize];
//         let ba = (b - a).normalize();
//         let ca = (c - a).normalize();
//         let normal = ba.cross(ca).normalize();

//         normals[indices[i] as usize] += normal;
//         normals[indices[i + 1] as usize] += normal;
//         normals[indices[i + 2] as usize] += normal;
//     }

//     normals
// }
