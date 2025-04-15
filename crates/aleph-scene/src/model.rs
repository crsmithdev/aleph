use {
    aleph_vk::{Buffer, Format},
    ash::vk::Handle,
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
pub struct Primitive {
    #[debug("{:x}", vertex_buffer.handle().as_raw())]
    pub vertex_buffer: Buffer<Vertex>,
    #[debug("{:x}", index_buffer.handle().as_raw())]
    pub index_buffer: Buffer<u32>,
    pub material_idx: Option<usize>,
    pub vertex_count: u32,
}

pub struct PrimitiveDesc {
    pub vertices: Vec<Vertex>,
    pub indices: Vec<u32>,
    pub material_idx: Option<usize>,
}

pub struct MeshDesc {
    pub name: String,
    pub primitives: Vec<PrimitiveDesc>,
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuMaterialData {
    pub color_factor: Vec4,
    pub metallic_factor: f32,
    pub roughness_factor: f32,
    pub ao_strength: f32,
    pub padding0: f32,
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuDrawData {
    pub model: Mat4,
    pub mv: Mat4,
    pub mvp: Mat4,
    pub transform: Mat4,
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct Light {
    pub position: Vec3,
    pub radius: f32,
    pub color: Vec4,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct Config {
    pub force_metallic: f32,
    pub force_roughness: f32,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            force_metallic: -1.,
            force_roughness: -1.,
        }
    }
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuSceneData {
    pub view: Mat4,
    pub projection: Mat4,
    pub vp: Mat4,
    pub camera_pos: Vec3,
    pub n_lights: i32,
    pub config: Config,
    pub padding0: Vec2,
    pub lights: [Light; 4],
}