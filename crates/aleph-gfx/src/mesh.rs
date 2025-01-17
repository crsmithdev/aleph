use aleph_hal::Buffer;
use aleph_hal::DeviceAddress;

use nalgebra_glm as glm;

#[derive(Default, serde::Serialize)]
pub struct Vertex{
    pub position: glm::Vec3,
    pub uv_x: f32,
    pub normal: glm::Vec3,
    pub uv_y: f32,
    pub color: glm::Vec4,
}

impl Vertex {
    pub fn position(self, x: f32, y: f32, z: f32) -> Self {
        Self { position: glm::vec3(x, y, z), ..self }
    }

    pub fn color(self, r: f32, g: f32, b: f32, a: f32) -> Self {
        Self { color: glm::vec4(r, g, b, a), ..self }
    }
}


pub struct Mesh {
    name: String,
    surfaces: Vec<GeoSurface>,
    uffers: GpuMeshBuffers
}

struct GeoSurface {
    start_index: u32,
    count: u32,
}

pub struct GpuMeshBuffers {
    pub index_buffer: Buffer,
    pub vertex_buffer: Buffer,
    pub vertex_buffer_address: DeviceAddress,
}
