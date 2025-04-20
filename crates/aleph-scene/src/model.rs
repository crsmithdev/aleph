use {
    crate::MaterialHandle,
    aleph_vk::{
        Buffer, Extent2D, Filter, Format, ImageAspectFlags, ImageUsageFlags, SamplerAddressMode,
        SamplerMipmapMode,
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
    pub vertex_buffer: Buffer<Vertex>,
    pub index_buffer: Buffer<u32>,
    pub material: Option<MaterialHandle>,
    pub vertex_count: u32,
}

#[derive(Debug)]
pub struct SamplerDesc {
    pub name: String,
    pub index: usize,
    pub min_filter: Filter,
    pub mag_filter: Filter,
    pub mipmap_mode: SamplerMipmapMode,
    pub address_mode_u: SamplerAddressMode,
    pub address_mode_y: SamplerAddressMode,
    pub anisotropy_enable: bool,
    pub max_anisotropy: f32,
}

#[derive(Debug)]
pub struct PrimitiveDesc {
    pub index: usize,
    pub vertices: Vec<Vertex>,
    pub indices: Vec<u32>,
    pub material: Option<MaterialHandle>,
}

#[derive(Debug)]
pub struct MeshDesc {
    pub name: String,
    pub index: usize,
    pub primitives: Vec<PrimitiveDesc>,
}

#[derive(Debug)]
pub struct TextureDesc {
    pub name: String,
    pub extent: Extent2D,
    pub format: Format,
    pub usage: ImageUsageFlags,
    pub aspect: ImageAspectFlags,
    pub data: Vec<u8>,
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
    pub force_color: Vec4,
    pub force_metallic: Vec2,
    pub force_roughness: Vec2,
    pub force_ao: Vec2,
    pub padding0: Vec2,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            force_color: Vec4::ZERO,
            force_metallic: Vec2::ZERO,
            force_roughness: Vec2::ZERO,
            force_ao: Vec2::ZERO,
            padding0: Vec2::ZERO,
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
    pub lights: [Light; 4],
}
