pub mod assets;
pub mod camera;
pub mod gltf;
pub mod graph;
pub mod material;
pub mod mikktspace;
pub mod model;
pub mod util;

use crate::mikktspace::{generate_tangents, MikktGeometry};
pub use crate::{
    assets::{Assets, MaterialHandle, MeshHandle, TextureHandle},
    camera::{Camera, CameraConfig},
    graph::{Node, NodeData, NodeDesc, Scene, SceneDesc},
    material::Material,
    model::{Mesh, MeshDesc, Primitive, PrimitiveDesc, Vertex},
};
