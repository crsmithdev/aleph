use {
    aleph_hal::{
        Buffer,
        BufferInfo,
        BufferUsageFlags,
        CommandBuffer,
        Context,
        DeviceAddress,
        MemoryLocation,
    },
    anyhow::Result,
    derive_more::Debug,
    gltf::Gltf,
    nalgebra_glm as glm,
    std::path::Path,
};

#[repr(C)]
#[derive(Copy, Clone, Debug, Default, serde::Serialize, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Vertex {
    pub position: glm::Vec3,
    pub uv_x: f32,
    pub normal: glm::Vec3,
    pub uv_y: f32,
    pub color: glm::Vec4,
}

impl Vertex {
    pub fn position(self, x: f32, y: f32, z: f32) -> Self {
        Self {
            position: glm::vec3(x, y, z),
            ..self
        }
    }

    pub fn color(self, r: f32, g: f32, b: f32, a: f32) -> Self {
        Self {
            color: glm::vec4(r, g, b, a),
            ..self
        }
    }
}

pub struct GpuMeshBuffers {
    pub index_buffer: Buffer,
    pub vertex_buffer: Buffer,
    pub vertex_buffer_address: DeviceAddress,
}
pub struct GeoSurface {
    start_index: u32,
    count: u32,
}

pub struct MeshAsset {
    name: String,
    surfaces: Vec<GeoSurface>,
    mesh_buffers: GpuMeshBuffers,
}

// pub fn load_meshes() -> Result<Vec<GpuMeshBuffers>> {
//     let mut meshes = Vec::new();

//     let gltf = Gltf::open("assets/basicmesh.glb")?;

// }

pub fn load_meshes(
    path: String,
    context: &Context,
    cmd: &CommandBuffer,
) -> Result<Vec<MeshAsset>> {
     
     /*
     pub position: glm::Vec3,
    pub uv_x: f32,
    pub normal: glm::Vec3,
    pub uv_y: f32,
    pub color: glm::Vec4,  vertex  */
    dbg!(std::mem::size_of::<Vertex>());
    dbg!(std::mem::size_of::<glm::Vec3>());
    dbg!(std::mem::size_of::<glm::Vec4>());
    dbg!(std::mem::size_of::<f32>());
    dbg!(bincode::serialized_size(&Vertex::default()));
    let (document, buffers, _images) = match gltf::import(path) {
        Ok(loaded) => loaded,
        Err(err) => panic!("GLTF loading error: {err:?}"),
    };

    let get_buffer_data = |buffer: gltf::Buffer| buffers.get(buffer.index()).map(|x| &*x.0);

    let mut meshes: Vec<MeshAsset> = vec![];

    for mesh in document.meshes() {
        for primitive in mesh.primitives().take(1) {
            let reader = primitive.reader(get_buffer_data);
            log::debug!("reader indices len: {:?}", reader.read_indices().unwrap().into_u32().count());
            log::debug!("reader @ first index: {:?}", reader.read_indices().unwrap().into_u32().next());
            log::debug!("reader @ last index: {:?}", reader.read_indices().unwrap().into_u32().last());
            
            let indices = reader
                .read_indices()
                .expect("Could not read mesh indices")
                .into_u32()
                .collect::<Vec<u32>>();
            let index_size = indices.len() * std::mem::size_of::<f32>();
            let index_buffer = context.create_buffer(BufferInfo {
                usage: BufferUsageFlags::INDEX_BUFFER | BufferUsageFlags::TRANSFER_DST,
                location: MemoryLocation::GpuOnly,
                size: index_size,
            })?;

            log::debug!("calculated index size: {:?}", index_size);
            log::debug!("indices len: {:?}", indices.len());
            log::debug!("indices @ first index: {:?}", indices[0]);
            log::debug!("indices @ last index: {:?}", indices[indices.len() - 1]);

            index_buffer.upload_data(cmd, &indices)?;
            let vertices: Vec<Vertex> = reader
            .read_positions()
            .expect("Mesh must have positions")
            .map(|p| {
                let v = Vertex {
                    position: p.into(),
                    uv_x: 0.0,
                    uv_y: 0.0,
                    color: glm::vec4(0.0, 0.0, 0.0, 0.0),
                    normal: glm::vec3(0.0, 0.0, 0.0),
                };
                // dbg!(&v);    
                v
            })
            .collect();
            let vertex_buffer = context.create_buffer(BufferInfo {
                usage: BufferUsageFlags::STORAGE_BUFFER
                    | BufferUsageFlags::TRANSFER_DST
                    | BufferUsageFlags::SHADER_DEVICE_ADDRESS,
                location: MemoryLocation::GpuOnly,
                size: vertices.len() * std::mem::size_of::<Vertex>(),
            })?;
            vertex_buffer.upload_data(cmd, &vertices)?;
            let vertex_buffer_address = unsafe {
                context.device().get_buffer_device_address(
                    &ash::vk::BufferDeviceAddressInfo::default().buffer(vertex_buffer.handle()),
                )
            };

            let m = MeshAsset {
                name: mesh.name().unwrap_or("Mesh").to_string(),
                surfaces: vec![GeoSurface {
                    start_index: 0,
                    count: indices.len() as u32,
                }],
                mesh_buffers: GpuMeshBuffers {
                    index_buffer,
                    vertex_buffer,
                    vertex_buffer_address,
                },
            };
            meshes.push(m);
        }
    }

    Ok(meshes)
}

// Read normals (optional)
// let normals: Vec<[f32; 3]> = reader
//     .read_normals()
//     .unwrap_or_else(|| vec![[0.0, 0.0, 0.0]; positions.len()])
//     .collect();

// // Read texture coordinates (optional)
// let tex_coords: Vec<[f32; 2]> = reader
//     .read_tex_coords(0)
//     .map(|tc| tc.into_f32().collect())
//     .unwrap_or_else(|| vec![[0.0, 0.0]; positions.len()]);

// // Combine vertex data
// let vertices: Vec<Vertex> = positions
//     .into_iter()
//     .zip(normals.into_iter())
//     .zip(tex_coords.into_iter())
//     .map(|((position, normal), texture_coordinates)| Vetex {
//         position: position.into(),
//         normal: normal.into(),
//     })
//     .collect();

// // Read indices
// let indices: Vec<u32> = reader
//     .read_indices()
//     .map(|indices| indices.into_u32().collect())
//     .unwrap_or_else(|| (0..vertices.len() as u32).collect());

// // Load textures (dummy for now; expand later)
// let textures = vec![];

// Create the StaticMesh
//             let static_mesh = StaticMesh::new(vertices, indices, textures);

//             static_meshes.push(static_mesh);
//         }
//     }

//     static_meshes
// }
