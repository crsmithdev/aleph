use {
    crate::{generate_tangents, MaterialHandle, MikktGeometry},
    aleph_vk::{Buffer, Format, PrimitiveTopology},
    anyhow::Result,
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

#[derive(Debug)]
pub struct Mesh {
    pub name: String,
    pub primitives: Vec<Primitive>,
}

#[derive(Debug)]
pub struct MeshDesc {
    pub name: String,
    pub index: usize,
    pub primitives: Vec<PrimitiveDesc>,
}

type Face = [u32; 3];

#[derive(Debug)]
pub struct Primitive {
    pub vertex_buffer: Buffer<Vertex>,
    pub index_buffer: Buffer<u32>,
    pub material: Option<MaterialHandle>,
    pub vertex_count: u32,
    pub topology: PrimitiveTopology,
}

impl Primitive {}

#[derive(Debug)]
pub struct PrimitiveDesc {
    pub vertices: Vec<Vertex>,
    pub indices: Vec<u32>,
    pub material: Option<MaterialHandle>,
    pub topology: PrimitiveTopology,
    // pub face_normals: Vec<Vec3>,
    pub faces: Vec<Face>,
}

impl PrimitiveDesc {
    pub fn new(
        vertices: Vec<Vertex>,
        indices: Vec<u32>,
        material: Option<MaterialHandle>,
        topology: PrimitiveTopology,
        _has_vertex_normals: bool,
        _has_tangents: bool,
    ) -> Self {
        // let faces = indices
        // .chunks_exact(3)
        // .map(|f| [f[0], f[1], f[2]])
        // .collect::<Vec<_>>();
        // let normals = Self::calculate_normals(&vertices, &indices);
        // let face_normals = normals.iter().step_by(3).copied().collect::<Vec<_>>();
        // if !has_vertex_normals {
        //     for i in 0..vertices.len() {
        //         vertices[i].normal = normals[i];
        //     }
        // }

        // if !has_tangents {
        //     for i in 0..vertices.len() {
        //         vertices[i].tangent = Vec4::ZERO;
        //     }
        // }

        let primitive = Self {
            vertices,
            indices,
            material,
            topology,
            faces: vec![], // faces,
                           // face_normals,
        };
        // primitive.calculate_tangents().expect("tangents"); //TODO
        primitive
    }

    pub fn normals<'a>(&'a self) -> impl Iterator<Item = Vec3> + 'a {
        self.vertices.iter().map(|v| v.normal)
    }

    pub fn tex_coords<'a>(&'a self) -> impl Iterator<Item = Vec2> + 'a {
        self.vertices.iter().map(|v| Vec2::new(v.uv_x, v.uv_y))
    }

    pub fn calculate_normals(vertices: &[Vertex], indices: &[u32]) -> Vec<Vec3> {
        let mut vertex_normals = vec![glam::Vec3::ZERO; vertices.len()];

        for i in (0..indices.len()).step_by(3) {
            let a = vertices[indices[i] as usize].position;
            let b = vertices[indices[i + 1] as usize].position;
            let c = vertices[indices[i + 2] as usize].position;
            let ba = (b - a).normalize();
            let ca = (c - a).normalize();
            let normal = ba.cross(ca).normalize();

            vertex_normals[indices[i] as usize] += normal;
            vertex_normals[indices[i + 1] as usize] += normal;
            vertex_normals[indices[i + 2] as usize] += normal;
        }
        for normal in &mut vertex_normals {
            *normal = normal.normalize();
        }

        vertex_normals
    }

    pub fn calculate_tangents(&mut self) -> Result<()> {
        match generate_tangents(self) {
            true => Ok(()),
            false => Err(anyhow::anyhow!(
                "Unsuitable geometry for tangent calculation"
            )),
        }
    }
}

impl MikktGeometry for PrimitiveDesc {
    fn num_faces(&self) -> usize { self.indices.len() / 3 }

    fn num_vertices_of_face(&self, _face: usize) -> usize { 3 }

    fn position(&self, face: usize, vert: usize) -> [f32; 3] {
        let i = self.indices[face * 3 + vert] as usize;
        self.vertices[i].position.into()
    }

    fn normal(&self, face: usize, vert: usize) -> [f32; 3] {
        let i = self.indices[face * 3 + vert] as usize;
        self.vertices[i].normal.into()
    }

    fn tex_coord(&self, face: usize, vert: usize) -> [f32; 2] {
        let i = self.indices[face * 3 + vert] as usize;
        let v = self.vertices[i];
        [v.uv_x, v.uv_y]
    }

    fn set_tangent_encoded(&mut self, tangent: [f32; 4], face: usize, vert: usize) {
        let i = self.indices[face * 3 + vert] as usize;
        self.vertices[i].tangent = Vec4::from(tangent);
    }
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct Light {
    pub position: Vec3,
    pub intensity: f32,
    pub color: Vec4,
}
