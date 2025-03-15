use {
    crate::scene::model::Vertex,
    anyhow::Result,
    ash::vk::{self, Extent2D},
    derive_more::Debug,
    glam::{Vec2, Vec3, Vec4},
};

#[derive(Debug)]
pub struct MaterialDesc {
    pub index: usize,
    pub name: String,
    pub albedo_texture: Option<usize>,
    pub albedo_sampler: Option<usize>,
    pub normal_texture: Option<usize>,
    pub normal_sampler: Option<usize>,
    pub occlusion_texture: Option<usize>,
    pub occlusion_sampler_idx: Option<usize>,
    pub metallic_roughnness_texture: Option<usize>,
    pub metallic_roughness_sampler: Option<usize>,
    pub metallic_factor: f32,
    pub roughness_factor: f32,
}

#[derive(Debug)]
pub struct MeshDesc {
    pub index: usize,
    pub primitives: Vec<PrimitiveDesc>,
}

#[derive(Debug)]
pub struct PrimitiveDesc {
    pub index: usize,
    pub mesh: usize,
    pub material: Option<usize>,
    #[debug("{:} vertrices", vertices.len())]
    pub vertices: Vec<Vertex>,
    #[debug("{:} indices", indices.len())]
    pub indices: Vec<u32>,
    pub tangents: Vec<Vec4>,
}

#[derive(Debug)]
pub struct TextureDesc {
    #[debug("{:} bytes", data.len())]
    pub data: Vec<u8>,
    pub name: String,
    pub extent: Extent2D,
    pub index: usize,
    pub format: vk::Format,
}

#[derive(Debug)]
pub struct SamplerDesc {
    pub index: usize,
    pub min_filter: vk::Filter,
    pub mag_filter: vk::Filter,
    pub mipmap_mode: vk::SamplerMipmapMode,
}

#[derive(Debug)]
pub struct NodeDesc {
    pub index: usize,
    pub name: Option<String>,
    pub parent: Option<usize>,
    pub children: Vec<usize>,
    pub mesh: Option<usize>,
    pub camera: Option<usize>,
    pub transform: gltf::scene::Transform,
}

#[derive(Debug)]
pub struct GltfDocument {
    pub materials: Vec<MaterialDesc>,
    pub samplers: Vec<SamplerDesc>,
    pub textures: Vec<TextureDesc>,
    pub meshes: Vec<MeshDesc>,
    pub scenes: Vec<SceneDesc>,
}

#[derive(Debug)]
pub struct SceneDesc {
    pub root_node_idxs: Vec<usize>,
    pub nodes: Vec<NodeDesc>,
}

pub fn load_gltf2(path: &str) -> Result<GltfDocument> {
    let (document, buffers, images) = gltf::import(path)?;
    let samplers = read_samplers(&document);
    let textures = read_textures(&document, &images);
    let materials = read_materials(&document);
    let meshes = read_meshes(&document, &buffers);
    let scenes = read_scenes(&document);

    Ok(GltfDocument {
        samplers,
        textures,
        meshes,
        materials,
        scenes,
    })
}

pub fn read_samplers(document: &gltf::Document) -> Vec<SamplerDesc> {
    document
        .samplers()
        .enumerate()
        .map(|(i, sampler)| {
            let min_filter = sampler
                .min_filter()
                .unwrap_or(gltf::texture::MinFilter::Nearest);
            let mag_filter = sampler
                .mag_filter()
                .unwrap_or(gltf::texture::MagFilter::Nearest);

            SamplerDesc {
                index: i as usize,
                min_filter: convert_min_filter(min_filter),
                mag_filter: convert_mag_filter(mag_filter),
                mipmap_mode: convert_mipmap_mode(min_filter),
            }
        })
        .collect()
}

pub fn read_textures(
    document: &gltf::Document,
    image_data: &[gltf::image::Data],
) -> Vec<TextureDesc> {
    document
        .textures()
        .enumerate()
        .map(|(i, texture)| {
            let image = &image_data[texture.source().index()];
            TextureDesc {
                name: format!("gltf-texture-{i}"),
                data: image.pixels.clone(),
                extent: Extent2D {
                    width: image.width,
                    height: image.height,
                },
                format: convert_format(image.format),
                index: texture.index() as usize,
            }
        })
        .collect()
}

pub fn read_materials(
    document: &gltf::Document,
) -> Vec<MaterialDesc> {
    document
        .materials()
        .enumerate()
        .map(|(i, material)| {
            let pbr = material.pbr_metallic_roughness();

            let base = pbr.base_color_texture().map(|i| i.texture());
            let base_sampler = base.as_ref().map(|t| t.sampler());
            let normal = material.normal_texture().map(|i| i.texture());
            let normal_sampler = normal.as_ref().map(|t| t.sampler());
            let occlusion = material.occlusion_texture().map(|i| i.texture());
            let occlusion_sampler = occlusion.as_ref().map(|t| t.sampler());
            let metallic = pbr.metallic_roughness_texture().map(|i| i.texture());
            let metallic_sampler = metallic.as_ref().map(|t| t.sampler());

            let name = match material.name() {
                Some(name) => format!("gltf-material{i} ({name})"),
                None => format!("gltf-material{i}"),
            };

            MaterialDesc {
                index: i as usize,
                name: name.to_string(),
                albedo_texture: base.map(|i| i.index()),
                albedo_sampler: base_sampler.and_then(|s| s.index()),
                normal_texture: normal.map(|i| i.index()),
                normal_sampler: normal_sampler.and_then(|s| s.index()),
                occlusion_sampler_idx: occlusion_sampler.and_then(|s| s.index()),
                occlusion_texture: occlusion.map(|i| i.index()),
                metallic_roughnness_texture: metallic.map(|i| i.index()),
                metallic_roughness_sampler: metallic_sampler.and_then(|s| s.index()),
                metallic_factor: pbr.metallic_factor(),
                roughness_factor: pbr.roughness_factor(),
            }
        })
        .collect()
}

pub fn read_meshes(
    document: &gltf::Document,
    buffers: &[gltf::buffer::Data],
) -> Vec<MeshDesc> {
    let meshes = document
        .meshes()
        .enumerate()
        .map(|(i, mesh)| {
            let primitives = mesh.primitives().enumerate().map(|(j, primitive)| {
                let reader = primitive.reader(|buffer| Some(&buffers[buffer.index()]));
                let positions = reader
                    .read_positions()
                    .map_or(Vec::new(), |positions| positions.map(Vec3::from).collect());
                let normals = reader
                    .read_normals()
                    .map_or(Vec::new(), |normals| normals.map(Vec3::from).collect());

                let to_vec = |coords: gltf::mesh::util::ReadTexCoords<'_>| -> Vec<Vec2> {
                    coords.into_f32().map(Vec2::from).collect()
                };
                let tex_coords_0 = reader.read_tex_coords(0).map_or(Vec::new(), to_vec);
                let tex_coords_1 = reader.read_tex_coords(1).map_or(Vec::new(), to_vec);
                let tangents = reader.read_tangents().map_or(Vec::new(), |tangents| {
                    tangents.map(Vec4::from).collect()
                });

                let vertices = positions
                    .iter()
                    .enumerate()
                    .map(|(index, position)| Vertex {
                        position: *position,
                        normal: *normals.get(index).unwrap_or(&Vec3::ZERO),
                        tex_coords_0: *tex_coords_0.get(index).unwrap_or(&Vec2::ZERO),
                        tex_coords_1: *tex_coords_1.get(index).unwrap_or(&Vec2::ZERO),
                        tangent: *tangents.get(index).unwrap_or(&Vec4::ZERO),
                        _padding1: 0.,
                        _padding2: 0.,
                    })
                    .collect();

                let indices = reader
                    .read_indices()
                    .map(|read_indices| read_indices.into_u32().collect::<Vec<_>>())
                    .unwrap();

                PrimitiveDesc {
                    index: j,
                    mesh: i,
                    material: primitive.material().index(),
                    vertices,
                    tangents,
                    indices,
                }
            });
            MeshDesc {
                index: i,
                primitives: primitives.collect(),
            }
        })
        .collect();

    meshes
}

pub fn read_scenes(document: &gltf::Document) -> Vec<SceneDesc> {
    let scenes = document
        .scenes()
        .map(|scene| {
            let mut root_node_idxs = vec![];
            let nodes: Vec<NodeDesc> = scene
                .nodes()
                .flat_map(|node| {
                    root_node_idxs.push(node.index());
                    read_node(node, None)
                })
                .collect();
            SceneDesc {
                root_node_idxs,
                nodes,
            }
        })
        .collect();

    scenes
}

fn read_node(node: gltf::Node, parent_idx: Option<usize>) -> Vec<NodeDesc> {
    let index = node.index();
    let mut nodes = vec![NodeDesc {
        index,
        parent: parent_idx, 
        name: node.name().map(|s| s.to_string()),
        children: node.children().map(|child| child.index()).collect(),
        mesh: node.mesh().map(|mesh| mesh.index()),
        camera: node.camera().map(|camera| camera.index()),
        transform: node.transform(),
    }];
    for child in node.children() {
        let child_nodes = read_node(child, Some(index));
        nodes.extend(child_nodes);
    }
    nodes
}

fn convert_mag_filter(filter: gltf::texture::MagFilter) -> vk::Filter {
    match filter {
        gltf::texture::MagFilter::Nearest => vk::Filter::NEAREST,
        gltf::texture::MagFilter::Linear => vk::Filter::LINEAR,
    }
}

fn convert_min_filter(filter: gltf::texture::MinFilter) -> vk::Filter {
    match filter {
        gltf::texture::MinFilter::Nearest => vk::Filter::NEAREST,
        gltf::texture::MinFilter::NearestMipmapNearest => vk::Filter::NEAREST,
        gltf::texture::MinFilter::NearestMipmapLinear => vk::Filter::NEAREST,
        gltf::texture::MinFilter::Linear => vk::Filter::LINEAR,
        gltf::texture::MinFilter::LinearMipmapNearest => vk::Filter::LINEAR,
        gltf::texture::MinFilter::LinearMipmapLinear => vk::Filter::LINEAR,
    }
}

fn convert_mipmap_mode(filter: gltf::texture::MinFilter) -> vk::SamplerMipmapMode {
    match filter {
        gltf::texture::MinFilter::Nearest => vk::SamplerMipmapMode::NEAREST,
        gltf::texture::MinFilter::NearestMipmapLinear => vk::SamplerMipmapMode::NEAREST,
        gltf::texture::MinFilter::NearestMipmapNearest => vk::SamplerMipmapMode::NEAREST,
        gltf::texture::MinFilter::Linear => vk::SamplerMipmapMode::LINEAR,
        gltf::texture::MinFilter::LinearMipmapNearest => vk::SamplerMipmapMode::LINEAR,
        gltf::texture::MinFilter::LinearMipmapLinear => vk::SamplerMipmapMode::LINEAR,
    }
}

fn convert_format(format: gltf::image::Format) -> vk::Format {
    match format {
        gltf::image::Format::R8 => vk::Format::R8_UNORM,
        gltf::image::Format::R8G8 => vk::Format::R8G8B8A8_UNORM,
        gltf::image::Format::R8G8B8 => vk::Format::R8G8B8A8_UNORM,
        gltf::image::Format::R8G8B8A8 => vk::Format::R8G8B8A8_UNORM,
        gltf::image::Format::R16 => vk::Format::R16G16B16A16_UNORM,
        gltf::image::Format::R16G16 => vk::Format::R16G16B16A16_UNORM,
        gltf::image::Format::R16G16B16 => vk::Format::R16G16B16A16_UNORM,
        gltf::image::Format::R16G16B16A16 => vk::Format::R16G16B16A16_UNORM,
        gltf::image::Format::R32G32B32FLOAT => vk::Format::R32G32B32A32_SFLOAT,
        gltf::image::Format::R32G32B32A32FLOAT => vk::Format::R32G32B32A32_SFLOAT,
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic() {
        let gltf = load_gltf2("../../assets/gltf/suzanne/Suzanne.gltf").expect("Failed to load test glTF file");
        assert_eq!(gltf.samplers.len(), 1);
        assert_eq!(gltf.textures.len(), 4);
        assert_eq!(gltf.materials.len(), 1);
        assert_eq!(gltf.meshes.len(), 1);
        assert_eq!(gltf.scenes.len(), 1);
        assert_eq!(gltf.scenes[0].root_node_idxs.len(), 1);
    }   
}
