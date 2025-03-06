use {
    super::assets::AssetHandle,
    crate::vk::Buffer,
    ash::vk::{Handle},
    bytemuck::{Pod, Zeroable},
    derive_more::Debug,
    glam::{Mat3, Mat4, Vec2, Vec3, Vec4},
};

#[repr(C)]
#[derive(Copy, Clone, Debug, Default, Pod, Zeroable)]
pub struct Vertex {
    pub position: Vec3,
    pub _padding1: f32,
    pub normal: Vec3,
    pub _padding2: f32,
    pub tex_coords_0: Vec2,
    pub tex_coords_1: Vec2,
    pub color: Vec4,
}

#[derive(Debug)]
pub enum Node {
    Mesh {
        local_transform: Mat4,
        mesh: Mesh,
        index: usize,
    },
    Group,
}

pub type Graph = petgraph::Graph<Node, ()>;

#[derive(Debug)]
pub struct Mesh {
    pub primitives: Vec<Primitive>,
}

#[derive(Debug)]
pub struct Primitive {
    #[debug("{:x}", vertex_buffer.handle().as_raw())]
    pub vertex_buffer: Buffer<Vertex>,
    #[debug("{:x}", index_buffer.handle().as_raw())]
    pub index_buffer: Buffer<u32>,
    pub material_index: Option<usize>,
    pub material: Option<AssetHandle>,
    pub model_buffer: Buffer<GpuDrawData>,
    pub model_matrix: Mat4,
    pub vertex_count: u32,
}


#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuSceneData {
    pub view: Mat4,             
    pub projection: Mat4,      
    pub view_projection: Mat4, 
    pub lights: [Vec3; 4],     
    pub _padding1: Vec4,       
    pub camera_position: Vec3, 
    pub _padding2: f32,
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuMaterialData {
    pub albedo: Vec4,
    pub _padding: f32,
    pub metallic: f32,
    pub roughness: f32,
    pub ao: f32,
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuDrawData {
    pub model: Mat4,                 // 0
    pub model_view: Mat4,            // 64
    pub model_view_projection: Mat4, // 128
    pub normal: Mat3,                // 192 + 36
    pub padding1: Vec3,              // 228 + 12
    pub position: Vec3,              // 240 + 12 = 252
    pub padding2: f32,
}
