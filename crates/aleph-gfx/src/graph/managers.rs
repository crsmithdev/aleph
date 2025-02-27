use {
    super::GpuDrawData,
    crate::{
        graph::mesh::{Mesh, MeshData, Vertex},
        vk::{BufferUsageFlags, Gpu},
        RenderObject,
    },
    anyhow::Result,
    derive_more::derive::Debug,
    glam::Mat4,
    std::mem,
};

#[derive(Default)]
pub struct ObjectManager {
    pub(crate) objects: Vec<RenderObject>,
}


impl ObjectManager {
    pub fn iter(&self) -> impl Iterator<Item = &RenderObject> { self.objects.iter() }

    pub fn add_mesh(&mut self, gpu: &Gpu, mesh: MeshData) -> Result<()> {
        let vertex_buffer_size = mem::size_of::<Vertex>() as u64 * mesh.vertices.len() as u64;
        let index_buffer_size = mem::size_of::<u32>() as u64 * mesh.indices.len() as u64;

        let vertex_buffer = gpu.create_device_buffer::<Vertex>(
            vertex_buffer_size,
                BufferUsageFlags::VERTEX_BUFFER | BufferUsageFlags::TRANSFER_DST,
                "vertex buffer"  
        )?;
        let vertex_staging = gpu.create_host_buffer(
            mesh.vertices.len() as u64 * mem::size_of::<Vertex>() as u64,
                BufferUsageFlags::TRANSFER_SRC,
                "vertex taging",
        )?;
        vertex_staging.write(&mesh.vertices);

        let index_buffer = gpu.create_device_buffer::<u32>(
                index_buffer_size,
                BufferUsageFlags::INDEX_BUFFER | BufferUsageFlags::TRANSFER_DST,
                "index buffer"
        )?;
        let index_staging = gpu.create_host_buffer::<u32>(
                index_buffer_size,
                BufferUsageFlags::TRANSFER_SRC,
                "index staging",
        )?;
        index_staging.write(&mesh.indices);

        gpu.execute(|cmd| {
            cmd.copy_buffer(&vertex_staging, &vertex_buffer, vertex_buffer.size());
            cmd.copy_buffer(&index_staging, &index_buffer, index_buffer.size());
        })?;

        let model_buffer = gpu.create_shared_buffer::<GpuDrawData>(
                mem::size_of::<GpuDrawData>() as u64,
                BufferUsageFlags::UNIFORM_BUFFER | BufferUsageFlags::TRANSFER_DST,
                "model buffer",
        )?;
        let vertex_count = mesh.indices.len() as u32;
        let mesh = Mesh {
            vertex_buffer,
            index_buffer,
            vertex_count,
        };

        self.objects.push(RenderObject {
            label: "test object", // TODO
            model_matrix: Mat4::IDENTITY,
            model_buffer,
            mesh,
        });

        Ok(())
    }
}

#[derive(Default, Debug)]
pub struct ResourceManager {}
