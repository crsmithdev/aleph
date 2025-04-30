use {
    crate::{
        mikktspace::{calculate_tangents, MikktGeometry},
        MaterialHandle,
    },
    aleph_vk::{Buffer, BufferUsageFlags, Format, Gpu, MemoryLocation, PrimitiveTopology},
    bytemuck::{Pod, Zeroable},
    derive_more::Debug,
    glam::{Vec2, Vec3, Vec4},
    std::sync::Arc,
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
pub struct MeshInfo {
    pub name: String,
    pub primitives: Vec<PrimitiveInfo>,
}

impl MeshInfo {
    pub fn new(
        indices: Vec<u32>,
        vertices: Vec<Vertex>,
        material: Option<MaterialHandle>,
        attributes: Vec<VertexAttribute>,
        name: &str,
    ) -> Self {
        let primitive = PrimitiveInfo::new(
            vertices,
            indices,
            material,
            PrimitiveTopology::TRIANGLE_LIST,
            attributes,
        );
        Self {
            name: name.to_string(),
            primitives: vec![primitive],
        }
    }
}

pub struct Face {
    pub indices: [u32; 3],
    pub normal: Vec3,
}

#[derive(Debug)]
pub struct Primitive {
    pub vertex_buffer: Buffer<Vertex>,
    pub index_buffer: Buffer<u32>,
    pub material: Option<MaterialHandle>,
    pub vertex_count: u32,
    pub topology: PrimitiveTopology,
}

impl Primitive {}

pub struct PrimitiveInfo {
    pub vertices: Vec<Vertex>,
    pub indices: Vec<u32>,
    pub material: Option<MaterialHandle>,
    pub topology: PrimitiveTopology,
    pub faces: Vec<Face>,
    pub attributes: Vec<VertexAttribute>,
}

impl Debug for PrimitiveInfo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let attributes = self
            .attributes
            .iter()
            .map(|a| format!("{:?}", a))
            .collect::<Vec<_>>();
        write!(
            f,
            "PrimitiveDesc(vertices: {}, indices: {}, faces: {}, material: {:?}, attributes: {:?})",
            self.vertices.len(),
            self.indices.len(),
            self.faces.len(),
            self.material,
            attributes,
        )
    }
}

#[derive(Debug, PartialEq)]
pub enum VertexAttribute {
    Position,
    Normal,
    TexCoord0,
    TexCoord1,
    Tangent,
    Color,
}

impl PrimitiveInfo {
    pub fn new(
        vertices: Vec<Vertex>,
        indices: Vec<u32>,
        material: Option<MaterialHandle>,
        topology: PrimitiveTopology,
        attributes: Vec<VertexAttribute>,
    ) -> Self {
        let mut vertices = vertices.clone();

        if !attributes.contains(&VertexAttribute::Normal) {
            let normals = calculate_normals(&mut vertices, indices.clone());
            for (i, vertex) in vertices.iter_mut().enumerate() {
                vertex.normal = normals[i];
            }
        }
        let faces = calculate_faces(&indices, &vertices);

        let mut primitive = Self {
            vertices,
            indices,
            material,
            topology,
            faces,
            attributes,
        };

        if !primitive.attributes.contains(&VertexAttribute::Tangent) {
            if !calculate_tangents(&mut primitive) {
                log::warn!("Error calculating tangents for primitive");
            }
        }

        primitive
    }

    pub fn normals<'a>(&'a self) -> impl Iterator<Item = Vec3> + 'a {
        self.vertices.iter().map(|v| v.normal)
    }

    pub fn tex_coords0<'a>(&'a self) -> impl Iterator<Item = Vec2> + 'a {
        self.vertices.iter().map(|v| Vec2::new(v.uv_x, v.uv_y))
    }
}

impl MikktGeometry for PrimitiveInfo {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_faces() {
        let vertices = vec![
            Vertex {
                position: Vec3::new(0.0, 0.0, 0.0),
                ..Default::default()
            },
            Vertex {
                position: Vec3::new(1.0, 0.0, 0.0),
                ..Default::default()
            },
            Vertex {
                position: Vec3::new(0.0, 1.0, 0.0),
                ..Default::default()
            },
        ];
        let indices = vec![0, 1, 2, 1, 2, 0, 2, 0, 1];
        calculate_faces(&indices, &vertices);
    }
}

fn calculate_faces(indices: &Vec<u32>, vertices: &Vec<Vertex>) -> Vec<Face> {
    indices
        .chunks_exact(3)
        .map(|idxs| {
            let a = vertices[idxs[0] as usize].position;
            let b = vertices[idxs[1] as usize].position;
            let c = vertices[idxs[2] as usize].position;
            let ba = (b - a).normalize();
            let ca = (c - a).normalize();
            let n = ba.cross(ca).normalize();

            Face {
                indices: [idxs[0], idxs[1], idxs[2]],
                normal: n,
            }
        })
        .collect()
}

fn calculate_normals(vertices: &mut Vec<Vertex>, indices: Vec<u32>) -> Vec<Vec3> {
    let mut normals = vec![glam::Vec3::ZERO; vertices.len()];

    for i in (0..indices.len()).step_by(3) {
        let a = vertices[indices[i] as usize].position;
        let b = vertices[indices[i + 1] as usize].position;
        let c = vertices[indices[i + 2] as usize].position;
        let ba = (b - a).normalize();
        let ca = (c - a).normalize();
        let normal = ba.cross(ca).normalize();

        normals[indices[i] as usize] += normal;
        normals[indices[i + 1] as usize] += normal;
        normals[indices[i + 2] as usize] += normal;
    }

    normals
}

pub fn create_index_buffer<T: Pod>(
    gpu: &Gpu,
    size: u64,
    location: MemoryLocation,
    label: impl Into<String>,
) -> anyhow::Result<Buffer<T>> {
    Buffer::new(
        &gpu.device(),
        Arc::clone(&gpu.allocator()),
        size,
        BufferUsageFlags::INDEX_BUFFER | BufferUsageFlags::TRANSFER_DST,
        location,
        label,
    )
}

pub fn create_vertex_buffer<T: Pod>(
    gpu: &Gpu,
    size: u64,
    location: MemoryLocation,
    label: impl Into<String>,
) -> anyhow::Result<Buffer<T>> {
    Buffer::new(
        &gpu.device(),
        Arc::clone(&gpu.allocator()),
        size,
        BufferUsageFlags::VERTEX_BUFFER | BufferUsageFlags::TRANSFER_DST,
        location,
        label,
    )
}
