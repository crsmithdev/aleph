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
    nalgebra as na,
    std::path::Path,
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

pub struct GpuMeshBuffers {
    pub index_buffer: Buffer,
    pub vertex_buffer: Buffer,
    pub vertex_buffer_address: DeviceAddress,
}
pub struct GeoSurface {
    pub start_index: u32,
    pub count: u32,
}

pub struct MeshAsset {
    pub name: String,
    pub surfaces: Vec<GeoSurface>,
    pub mesh_buffers: GpuMeshBuffers,
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
    let (document, buffers, _images) = match gltf::import(path) {
        Ok(loaded) => loaded,
        Err(err) => panic!("GLTF loading error: {err:?}"),
    };

    let get_buffer_data = |buffer: gltf::Buffer| buffers.get(buffer.index()).map(|x| &*x.0);

    let mut meshes: Vec<MeshAsset> = vec![];

    for mesh in document.meshes() {
        for primitive in mesh.primitives().take(1) {
            let reader = primitive.reader(get_buffer_data);
            let positions = reader.read_positions().unwrap();
            let normals = reader.read_normals().unwrap();
            // let colors = reader.read_colors(0).unwrap();
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
            let index_buffer = context.create_buffer(BufferInfo {
                usage: BufferUsageFlags::INDEX_BUFFER | BufferUsageFlags::TRANSFER_DST,
                location: MemoryLocation::GpuOnly,
                size: indices.len() * std::mem::size_of::<f32>(),
            })?;
            index_buffer.upload_data(cmd, &indices)?;

            // let positions = reader
            //     .read_positions()
            //     .map(|p| {
            //         let p2 = p.collect();
            //         glm::vec3(p2[0], p2[1], p2[2])
            //     });
            // let vertices = positions.map(|p| glm::vec3(p[0], p[1], p[2]));
            // let normals = reader.read_normals().map(|n| n.collect::<Vec<[f32; 3]>>());
            // let uvs = reader.read_tex_coords(0).map(|t| t.into_f32().collect());
            // let indices = reader
            //     .read_indices()
            //     .map(|i| i.into_u32().collect::<Vec<u32>>());

            // let all = vertices.zip(normals).zip(colors).zip(tex_coords).expect("something bad");
            // let vertices: Vec<Vertex> = all
            //     .map(|(((position, normal), color), tex_coord)| {
            //         position.
            //         let v = Vertex {
            //             position: glm::vec3(position[0], position[1], position[2]),
            //             normal: normal.into(),
            //             color: if override_colors {
            //                 glm::vec4(1.0, 1.0, 1.0, 1.0)
            //             } else {
            //                 color.map_or(glm::vec4(1.0, 1.0, 1.0, 1.0), |c| c.into())
            //             },
            //             uv_x: tex_coord.map_or(0.0, |tc| tc[0]),
            //             uv_y: tex_coord.map_or(0.0, |tc| tc[1]),
            //         };
            //         // dbg!(&v);
            //         v
            //     })
            //     .collect();
            // let vertices: Vec<Vertex> = reader
            //     .read_positions()
            //     .expect("Mesh must have positions")
            //     .map(|p| {
            //         let v = Vertex {
            //             position: p.into(),
            //             uv_x: 0.0,
            //             uv_y: 0.0,
            //             color: glm::vec4(1.0, 1.0, 1.0, 1.0),
            //             normal: glm::vec3(1.0, 0.0, 0.0),
            //         };
            //         // dbg!(&v);
            //         v
            //     })
            //     .collect();
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
