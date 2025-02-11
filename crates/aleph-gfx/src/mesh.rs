use {
    crate::vk::{Buffer, DeviceAddress},
    anyhow::{anyhow, Result},
    derive_more::Debug,
    glam::{vec3, vec4, Vec3, Vec4},
    itertools::izip,
};

#[repr(C)]
#[derive(Copy, Clone, Debug, Default, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Vertex {
    pub position: Vec3,
    pub uv_x: f32,
    pub normal: Vec3,
    pub uv_y: f32,
    pub color: Vec4,
}

impl Vertex {
    pub fn position(self, x: f32, y: f32, z: f32) -> Self {
        Self {
            position: vec3(x, y, z),
            ..self
        }
    }

    pub fn color(self, r: f32, g: f32, b: f32, a: f32) -> Self {
        Self {
            color: vec4(r, g, b, a),
            ..self
        }
    }
}

#[derive(Debug)]
pub struct Mesh {
    pub index_buffer: Buffer,
    pub vertex_buffer: Buffer,
    pub vertex_count: u32,
}

impl Mesh {
}

pub struct MeshData {
    pub vertices: Vec<Vertex>,
    pub indices: Vec<u32>,
}

pub fn load_mesh_data(path: &str) -> Result<Vec<MeshData>> {
    let (document, buffers, _images) = match gltf::import(path) {
        Ok(loaded) => loaded,
        Err(err) => return Err(anyhow!("Error reading gltf file").context(err)),
    };

    let get_buffer_data = |buffer: gltf::Buffer| buffers.get(buffer.index()).map(|x| &*x.0);
    let mut meshes: Vec<MeshData> = vec![];

    for mesh in document.meshes() {
        for primitive in mesh.primitives().take(1) {
            let reader = primitive.reader(get_buffer_data);
            let positions = reader
                .read_positions()
                .ok_or(anyhow::anyhow!("Error reading mesh positions"))?;
            let normals = reader
                .read_normals()
                .ok_or(anyhow::anyhow!("Error reading mesh normals"))?;
            let tex_coords = reader
                .read_tex_coords(0)
                .ok_or(anyhow::anyhow!("Error reading mesh tex_coords"))?
                .into_f32();

            let vertices: Vec<Vertex> = izip!(positions, normals, tex_coords)
                .map(|(position, normal, tex_coord)| Vertex {
                    position: position.into(),
                    normal: normal.into(),
                    uv_x: tex_coord[0],
                    uv_y: tex_coord[1],
                    color: vec4(normal[0], normal[1], normal[2], 1.0),
                })
                .collect();
            let indices = reader
                .read_indices()
                .ok_or(anyhow::anyhow!("Error reading mesh indices"))?
                .into_u32()
                .collect::<Vec<u32>>();

            let data = MeshData { vertices, indices };
            meshes.push(data);
        }
    }
    Ok(meshes)
}
