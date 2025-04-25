use {
    crate::{
        assets::MaterialHandle,
        mikktspace::{self, MikktGeometry},
    },
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
        match mikktspace::generate_tangents(self) {
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
    pub radius: f32,
    pub color: Vec4,
}

// fn get_position<I: MikktGeometry>(geometry: &mut I, index: usize) -> Vec3 {
//     let (face, vert) = index_to_face_vert(index);
//     geometry.position(face, vert).into()
// }

// fn get_tex_coord<I: MikktGeometry>(geometry: &mut I, index: usize) -> Vec3 {
//     let (face, vert) = index_to_face_vert(index);
//     let tex_coord: Vec2 = geometry.tex_coord(face, vert).into();
//     let val = tex_coord.extend(1.0);
//     val
// }

// fn get_normal<I: MikktGeometry>(geometry: &mut I, index: usize) -> Vec3 {
//     let (face, vert) = index_to_face_vert(index);
//     geometry.normal(face, vert).into()
// }
// struct MikktspaceGeometryHelper<'a> {
//     indices: Option<&'a Indices>,
//     positions: &'a Vec<[f32; 3]>,
//     normals: &'a Vec<[f32; 3]>,
//     uvs: &'a Vec<[f32; 2]>,
//     tangents: Vec<[f32; 4]>,
// }

// impl MikktspaceGeometryHelper<'_> {
//     fn index(&self, face: usize, vert: usize) -> usize {
//         let index_index = face * 3 + vert;

//         match self.indices {
//             Some(Indices::U16(indices)) => indices[index_index] as usize,
//             Some(Indices::U32(indices)) => indices[index_index] as usize,
//             None => index_index,
//         }
//     }
// }

// pub(crate) fn generate_tangents_for_mesh(
//     mesh: &Mesh,
// ) -> Result<Vec<[f32; 4]>, GenerateTangentsError> {
//     match mesh.primitive_topology() {
//         PrimitiveTopology::TriangleList => {}
//         other => return Err(GenerateTangentsError::UnsupportedTopology(other)),
//     };

//     let positions = mesh.attribute(Mesh::ATTRIBUTE_POSITION).ok_or(
//         GenerateTangentsError::MissingVertexAttribute(Mesh::ATTRIBUTE_POSITION.name),
//     )?;
//     let VertexAttributeValues::Float32x3(positions) = positions else {
//         return Err(GenerateTangentsError::InvalidVertexAttributeFormat(
//             Mesh::ATTRIBUTE_POSITION.name,
//             VertexFormat::Float32x3,
//         ));
//     };
//     let normals = mesh.attribute(Mesh::ATTRIBUTE_NORMAL).ok_or(
//         GenerateTangentsError::MissingVertexAttribute(Mesh::ATTRIBUTE_NORMAL.name),
//     )?;
//     let VertexAttributeValues::Float32x3(normals) = normals else {
//         return Err(GenerateTangentsError::InvalidVertexAttributeFormat(
//             Mesh::ATTRIBUTE_NORMAL.name,
//             VertexFormat::Float32x3,
//         ));
//     };
//     let uvs = mesh.attribute(Mesh::ATTRIBUTE_UV_0).ok_or(
//         GenerateTangentsError::MissingVertexAttribute(Mesh::ATTRIBUTE_UV_0.name),
//     )?;
//     let VertexAttributeValues::Float32x2(uvs) = uvs else {
//         return Err(GenerateTangentsError::InvalidVertexAttributeFormat(
//             Mesh::ATTRIBUTE_UV_0.name,
//             VertexFormat::Float32x2,
//         ));
//     };

//     let len = positions.len();
//     let tangents = vec![[0., 0., 0., 0.]; len];
//     let mut mikktspace_mesh = MikktspaceGeometryHelper {
//         indices: mesh.indices(),
//         positions,
//         normals,
//         uvs,
//         tangents,
//     };
//     let success = bevy_mikktspace::generate_tangents(&mut mikktspace_mesh);
//     if !success {
//         return Err(GenerateTangentsError::MikktspaceError);
//     }

//     // mikktspace seems to assume left-handedness so we can flip the sign to correct for this
//     for tangent in &mut mikktspace_mesh.tangents {
//         tangent[3] = -tangent[3];
//     }

//     Ok(mikktspace_mesh.tangents)
// }

// /// Correctly scales and renormalizes an already normalized `normal` by the scale determined by its reciprocal `scale_recip`
// pub(crate) fn scale_normal(normal: Vec3, scale_recip: Vec3) -> Vec3 {
//     // This is basically just `normal * scale_recip` but with the added rule that `0. * anything == 0.`
//     // This is necessary because components of `scale_recip` may be infinities, which do not multiply to zero
//     let n = Vec3::select(normal.cmpeq(Vec3::ZERO), Vec3::ZERO, normal * scale_recip);

//     // If n is finite, no component of `scale_recip` was infinite or the normal was perpendicular to the scale
//     // else the scale had at least one zero-component and the normal needs to point along the direction of that component
//     if n.is_finite() {
//         n.normalize_or_zero()
//     } else {
//         Vec3::select(n.abs().cmpeq(Vec3::INFINITY), n.signum(), Vec3::ZERO).normalize()
//     }
// }
