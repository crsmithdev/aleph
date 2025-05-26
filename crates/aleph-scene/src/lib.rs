pub mod assets;
pub mod camera;
pub mod gltf;
pub mod graph;
pub mod material;
pub mod mikktspace;
pub mod model;
pub mod primitives;
pub mod util;

pub use crate::{
    assets::{Assets, MaterialHandle, MeshHandle, TextureHandle},
    camera::{Camera, CameraConfig},
    graph::{Node, NodeType, Scene},
    material::Material,
    model::Vertex,
};

#[cfg(test)]
#[allow(dead_code)]
mod test {
    use {
        aleph_vk::Gpu,
        std::sync::{Arc, LazyLock},
    };

    static TEST_GPU: LazyLock<Arc<Gpu>> =
        LazyLock::new(|| Arc::new(Gpu::headless().expect("Error creating test GPU")));

    pub fn test_gpu() -> &'static Arc<Gpu> { &TEST_GPU }
}
