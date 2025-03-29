use {
    crate::vk::{
        Buffer, Handle,
    },
    bytemuck::{Pod, Zeroable},
    derive_more::Debug,
    glam::{Mat4, Vec2, Vec3, Vec4},
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
    pub normal_derived: Vec3,
    pub _padding: f32,
}

#[derive(Debug)]
pub struct Mesh {
    pub name: String,
    pub primitives: Vec<Primitive>,
}

#[derive(Debug)]
pub struct Primitive {
    #[debug("{:x}", vertex_buffer.handle().as_raw())]
    pub vertex_buffer: Buffer<Vertex>,
    #[debug("{:x}", index_buffer.handle().as_raw())]
    pub index_buffer: Buffer<u32>,
    #[debug("{:x}", model_buffer.handle().as_raw())]
    pub model_buffer: Buffer<GpuDrawData>,
    pub material_idx: Option<usize>,
    pub vertex_count: u32,
    pub transform: Mat4,
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuMaterialData {
    pub base_color_factor: Vec4,
    pub metallic_factor: f32,
    pub roughness_factor: f32,
    pub _padding: Vec2,
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuDrawData {
    pub model: Mat4,
    pub view: Mat4,
    pub projection: Mat4,
    pub model_view: Mat4,
    pub view_projection: Mat4,
    pub model_view_projection: Mat4,
    pub world_transform: Mat4,
    pub view_inverse: Mat4,
    pub model_view_inverse: Mat4,
    pub normal: Mat4,
    pub camera_pos: Vec3,
    pub _padding: f32,
}
