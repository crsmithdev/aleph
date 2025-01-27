use {
    aleph_hal::{
        Buffer, BufferInfo, BufferUsageFlags, CommandBuffer, DeletionQueue, DeviceAddress, Gpu, MemoryLocation
    },
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

pub struct MeshData {
    pub vertices: Vec<Vertex>,
    pub indices: Vec<u32>,
}

pub fn load_meshes2(
    path: String,
) -> Result<Vec<MeshData>> {
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

            meshes.push(MeshData {vertices, indices});
            // let index_buffer = gpu.create_buffer(BufferInfo {
            //     label: Some("index"),
            //     usage: BufferUsageFlags::INDEX_BUFFER | BufferUsageFlags::TRANSFER_DST,
            //     location: MemoryLocation::GpuOnly,
            //     size: indices.len() * std::mem::size_of::<f32>(),
            // })?;
            // index_buffer.upload(cmd, &indices)?;

            // let vertex_buffer = gpu.create_buffer(BufferInfo {
            //     label: Some("vertex"),
            //     usage: BufferUsageFlags::STORAGE_BUFFER
            //         | BufferUsageFlags::TRANSFER_DST
            //         | BufferUsageFlags::SHADER_DEVICE_ADDRESS,
            //         location: MemoryLocation::GpuOnly,
            //         size: vertices.len() * std::mem::size_of::<Vertex>(),
            // })?;
            // vertex_buffer.upload(cmd, &vertices)?;
            // let vertex_buffer_address = vertex_buffer.device_address();//unsafe {

            // // gpu.deletion_queue.enqueue(|| {
            //     // index_buffer.destroy();
            //     // verte.destroy();
            // // });

            // let m = MeshAsset {
            //     name: mesh.name().unwrap_or("Mesh").to_string(),
            //     surfaces: vec![GeoSurface {
            //         start_index: 0,
            //         count: indices.len() as u32,
            //     }],
            //     mesh_buffers: GpuMeshBuffers {
            //         index_buffer,
            //         vertex_buffer,
            //         vertex_buffer_address,
            //     },
            // };
            // meshes.push(m);

        }
    }

    Ok(meshes)
}

pub fn load_meshes(
    path: String,
    gpu: &mut Gpu,
    cmd: &CommandBuffer,
) -> Result<Vec<MeshAsset>> {
    let (document, buffers, _images) = match gltf::import(path) {
        Ok(loaded) => loaded,
        Err(err) => panic!("GLTF loading error: {err:?}"),
    };

    let get_buffer_data = |buffer: gltf::Buffer| buffers.get(buffer.index()).map(|x| &*x.0);
    // let deletion_queue = &gpu.deletion_queue;

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
            let index_buffer = gpu.create_buffer(BufferInfo {
                label: Some("index"),
                usage: BufferUsageFlags::INDEX_BUFFER | BufferUsageFlags::TRANSFER_DST,
                location: MemoryLocation::GpuOnly,
                size: indices.len() * std::mem::size_of::<f32>(),
            })?;
            index_buffer.upload(cmd, &indices)?;

            let vertex_buffer = gpu.create_buffer(BufferInfo {
                label: Some("vertex"),
                usage: BufferUsageFlags::STORAGE_BUFFER
                    | BufferUsageFlags::TRANSFER_DST
                    | BufferUsageFlags::SHADER_DEVICE_ADDRESS,
                    location: MemoryLocation::GpuOnly,
                    size: vertices.len() * std::mem::size_of::<Vertex>(),
            })?;
            vertex_buffer.upload(cmd, &vertices)?;
            let vertex_buffer_address = vertex_buffer.device_address();//unsafe {

            // gpu.deletion_queue.enqueue(|| {
                // index_buffer.destroy();
                // verte.destroy();
            // });

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