pub mod camera;
pub mod gltf;
pub mod material;
pub mod model;
pub mod util;

use {
    crate::vk::{self, Extent2D, Filter, Gpu, ImageUsageFlags, SamplerMipmapMode, Texture},
    anyhow::Result,
    derive_more::Debug,
    glam::Mat4,
    std::{collections::HashMap, mem::size_of},
    tracing::instrument,
};

pub use crate::scene::{
    camera::{Camera, CameraConfig},
    gltf::{GltfDocument, MaterialDesc, PrimitiveDesc, SamplerDesc, TextureDesc},
    material::{AssetCache, AssetHandle, Material},
    model::{GpuDrawData, Mesh, Primitive, Vertex},
};

