use {
    aleph_hal::{Buffer, DeviceAddress},
    anyhow::Result,
    derive_more::Debug,
    nalgebra as na,
};

#[repr(C)]
#[derive(Copy, Clone, Debug, Default, serde::Serialize, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Vertex {
    pub position: na::Vector3<f32>,
    pub uv_x: f32,
    pub normal: na::Vector3<f32>,
    pub uv_y: f32,
    pub color: na::Vector4<f32>,
}

impl Vertex {
    pub fn position(self, x: f32, y: f32, z: f32) -> Self {
        Self {
            position: na::Vector3::new(x, y, z),
            ..self
        }
    }

    pub fn color(self, r: f32, g: f32, b: f32, a: f32) -> Self {
        Self {
            color: na::Vector4::new(r, g, b, a),
            ..self
        }
    }
}

#[derive(Debug)]
pub struct GpuMeshBuffers {
    pub index_buffer: Buffer,
    pub vertex_buffer: Buffer,
    pub vertex_buffer_address: DeviceAddress,
}

#[derive(Debug)]
pub struct GeoSurface {
    pub start_index: u32,
    pub count: u32,
}

#[derive(Debug)]
pub struct MeshAsset {
    pub name: String,
    pub surfaces: Vec<GeoSurface>,
    pub mesh_buffers: GpuMeshBuffers,
}

pub struct MeshData {
    pub vertices: Vec<Vertex>,
    pub indices: Vec<u32>,
}

pub fn load_meshes2(path: &str) -> Result<Vec<MeshData>> {
    let (document, buffers, _images) = match gltf::import(path) {
        Ok(loaded) => loaded,
        Err(err) => panic!("GLTF loading error: {err:?}"),
    };

    let get_buffer_data = |buffer: gltf::Buffer| buffers.get(buffer.index()).map(|x| &*x.0);
    let mut meshes: Vec<MeshData> = vec![];

    for mesh in document.meshes() {
        for primitive in mesh.primitives().take(1) {
            let reader = primitive.reader(get_buffer_data);
            let positions = reader.read_positions().unwrap();
            let normals = reader.read_normals().unwrap();
            let tex_coords = reader.read_tex_coords(0).unwrap().into_f32();

            let mut vertices = Vec::with_capacity(positions.len());
            for ((position, normal), tex_coord) in positions.zip(normals).zip(tex_coords) {
                vertices.push(Vertex {
                    position: position.into(),
                    normal: normal.into(),
                    uv_x: tex_coord[0],
                    uv_y: tex_coord[1],
                    color: na::Vector4::new(1.0, 1.0, 1.0, 1.0),
                });
            }

            for v in vertices.iter_mut() {
                v.color = na::Vector4::new(v.normal[0], v.normal[1], v.normal[2], 1.0);
            }

            let indices = reader
                .read_indices()
                .expect("Could not read mesh indices")
                .into_u32()
                .collect::<Vec<u32>>();

            log::info!("loaded mesh, vertices: {}, indices: {}", vertices.len(), indices.len());
            log::info!("first vertex: {:?} & index: {:?}", vertices[0], indices[0]);
            let data = MeshData { vertices, indices };
            meshes.push(data);
        }
    }

    Ok(meshes)
}
