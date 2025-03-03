use {
    super::{mesh::{Mesh, Primitive, VertexSet}, util, GpuDrawData},
    crate::{
        graph::mesh::{MeshData, Vertex},
        vk::{BufferUsageFlags, Gpu, Texture},
        RenderObject,
    },
    anyhow::Result,
    ash::vk::{self, Extent2D, Format, ImageAspectFlags, ImageUsageFlags},
    core::str,
    derive_more::derive::Debug,
    glam::{vec4, Mat4, Vec4},
    std::{collections::HashMap, mem, path::Path},
};

#[derive(Default)]
pub struct ObjectManager {
    pub(crate) objects: Vec<RenderObject>,
}

impl ObjectManager {
    pub fn iter(&self) -> impl Iterator<Item = &RenderObject> { self.objects.iter() }

    // pub fn add_mesh(&mut self, gpu: &Gpu, mesh: MeshData) -> Result<()> {
    //     let index_buffer_size = mem::size_of::<u32>() as u64 * mesh.indices.len() as u64;
    //     let index_buffer = util::index_buffer(gpu, index_buffer_size, "index buffer")?;
    //     let index_staging = util::staging_buffer(gpu, &mesh.indices, "index staging")?;

    //     let vertex_buffer_size = mem::size_of::<Vertex>() as u64 * mesh.vertices.len() as u64;
    //     let vertex_buffer = util::vertex_buffer(gpu, vertex_buffer_size, "vertex buffer")?;
    //     let vertex_staging = util::staging_buffer(gpu, &mesh.vertices, "vertex staging")?;

    //     gpu.execute(|cmd| {
    //         cmd.copy_buffer(&vertex_staging, &vertex_buffer, vertex_buffer.size());
    //         cmd.copy_buffer(&index_staging, &index_buffer, index_buffer.size());
    //     })?;

    //     let model_buffer = gpu.create_shared_buffer::<GpuDrawData>(
    //         mem::size_of::<GpuDrawData>() as u64,
    //         BufferUsageFlags::UNIFORM_BUFFER | BufferUsageFlags::TRANSFER_DST,
    //         "model buffer",
    //     )?;
    //     let vertex_count = mesh.indices.len() as u32;
    //     let mesh = Mesh {
    //         vertex_buffer,
    //         index_buffer,
    //         vertex_count,
    //     };

    //     self.objects.push(RenderObject {
    //         label: "test object", // TODO
    //         model_matrix: Mat4::IDENTITY,
    //         model_buffer,
    //         mesh,
    //     });

    //     Ok(())
    // }


    // pub fn add_mesh2(&mut self, gpu: &Gpu, vertices: &VertexSet, indices: &[u32]) -> Result<()> {
    //     let vertices: &[Vertex] = &vertices.vertices;
    //     let index_buffer_size = mem::size_of::<u32>() as u64 * indices.len() as u64;
    //     let index_buffer = util::index_buffer(gpu, index_buffer_size, "index buffer")?;
    //     let index_staging = util::staging_buffer(gpu, &indices, "index staging")?;

    //     let vertex_buffer_size = mem::size_of::<Vertex>() as u64 * vertices.len() as u64;
    //     let vertex_buffer = util::vertex_buffer2(gpu, vertex_buffer_size, "vertex buffer")?;
    //     let vertex_staging = util::staging_buffer(gpu, vertices, "vertex staging")?;

    //     gpu.execute(|cmd| {
    //         cmd.copy_buffer(&vertex_staging, &vertex_buffer, vertex_buffer.size());
    //         cmd.copy_buffer(&index_staging, &index_buffer, index_buffer.size());
    //     })?;

    //     let model_buffer = gpu.create_shared_buffer::<GpuDrawData>(
    //         mem::size_of::<GpuDrawData>() as u64,
    //         BufferUsageFlags::UNIFORM_BUFFER | BufferUsageFlags::TRANSFER_DST,
    //         "model buffer",
    //     )?;
    //     let vertex_count = indices.len() as u32;
    //     let primitive = Primitive {
    //         vertex_buffer,
    //         index_buffer,
    //         material_index: None,
    //         vertex_count,
    //     };


    //     self.objects.push(RenderObject {
    //         label: "test object", // TODO
    //         model_matrix: Mat4::IDENTITY,
    //         model_buffer,
    //         mesh: primitive,
    //     });

    //     Ok(())
    // }
}

#[derive(Default, Debug)]
pub struct ResourceManager {
    textures: HashMap<String, Texture>,
}

impl ResourceManager {
    pub fn load_texture(
        &mut self,
        gpu: &Gpu,
        path: impl Into<String>,
        name: impl Into<String>,
    ) -> Result<()> {
        let image = image::open(path.into())?;
        let image = image.to_rgba16();
        let data = image.as_raw();
        let extent = Extent2D {
            width: image.width(),
            height: image.height(),
        };
        let format = Format::R16G16B16A16_UNORM;
        let bytes = bytemuck::cast_slice(data);
        self.create_image(gpu, bytes, extent, format, name)
    }

    pub fn create_image(
        &mut self,
        gpu: &Gpu,
        data: &[u8],
        extent: Extent2D,
        format: vk::Format,
        name: impl Into<String>,
    ) -> Result<()> {
        let name: String = name.into();
        let image = gpu.create_image(extent, format, ImageUsageFlags::SAMPLED, ImageAspectFlags::COLOR, name.clone())?;
        let staging = util::staging_buffer(gpu, data, "texture staging")?;
        gpu.execute(|cmd| cmd.copy_buffer_to_image(&staging, &image))?;
        self.textures.insert(name, image);
        Ok(())
    }
    pub fn create_error_texture(&mut self, gpu: &Gpu) -> Result<()> {
        let pixels = (0..256).map(|i| match i % 2 {
            0 => 0,
            _ => 4294902015u32,
        });
        let data: Vec<u8> = pixels.into_iter().flat_map(|i| i.to_le_bytes()).collect();
        let extent = Extent2D {
            width: 16,
            height: 16,
        };
        self.create_image(gpu, &data, extent, Format::R8G8B8A8_UNORM, "error")
    }

    pub fn create_single_color_image(
        &mut self,
        gpu: &Gpu,
        color: Vec4,
        name: impl Into<String>,
    ) -> Result<()> {
        let data = [packUnorm4x8(color)];
        let extent = Extent2D {
            width: 1,
            height: 1,
        };
        let data = bytemuck::cast_slice(&data);
        self.create_image(gpu, &data, extent, Format::R8G8B8A8_UNORM, name)
    }

    pub fn get_texture(&self, name: &str) -> Option<&Texture> { self.textures.get(name) }
}

#[inline]
#[allow(non_snake_case)]
pub fn packUnorm4x8(v: Vec4) -> u32 {
    let us = v.clamp(vec4(0., 0., 0., 0.), vec4(1., 1., 1., 1.)).round();
    let pack: [u8; 4] = [us.w as u8, us.z as u8, us.y as u8, us.x as u8];
    let r: &u32 = unsafe { mem::transmute(&pack) };
    *r
}
