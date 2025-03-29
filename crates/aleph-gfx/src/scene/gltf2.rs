use {
    crate::scene::model::Vertex,
    anyhow::Result,
    ash::vk::{self, Extent2D},
    derive_more::Debug,
    glam::{Mat4, Quat, Vec2, Vec3, Vec4},
    std::hint::black_box,
};

#[derive(Debug)]
pub struct MaterialDesc {
    pub name: String,
    pub base_color_tx: Option<usize>,
    pub base_color_factor: [f32; 4],
    pub base_color_sampler: Option<usize>,
    pub normal_texture: Option<usize>,
    pub normal_sampler: Option<usize>,
    pub occlusion_texture: Option<usize>,
    pub occlusion_sampler: Option<usize>,
    pub metallic_roughnness_texture: Option<usize>,
    pub metallic_roughness_sampler: Option<usize>,
    pub metallic_factor: f32,
    pub roughness_factor: f32,
}

#[derive(Debug)]
pub struct MeshDesc {
    pub name: String,
    pub index: usize,
    pub primitives: Vec<PrimitiveDesc>,
}

#[derive(Debug)]
pub struct PrimitiveDesc {
    pub name: String,
    pub material: Option<usize>,
    #[debug("{:} vertrices", vertices.len())]
    pub vertices: Vec<Vertex>,
    #[debug("{:} indices", indices.len())]
    pub indices: Vec<u32>,
    #[debug("{:} tangents", tangents.len())]
    pub tangents: Vec<Vec4>,
    #[debug("{:} colors", colors.len())]
    pub colors: Vec<Vec4>,
}

#[derive(Debug)]
pub struct TextureDesc {
    #[debug("{:} bytes", data.len())]
    pub data: Vec<u8>,
    pub name: String,
    pub extent: Extent2D,
    pub index: usize,
    pub format: vk::Format,
    pub gltf_format: gltf::image::Format,
}

#[derive(Debug)]
pub struct SamplerDesc {
    pub index: usize,
    pub min_filter: vk::Filter,
    pub mag_filter: vk::Filter,
    pub mipmap_mode: vk::SamplerMipmapMode,
    pub address_mode_u: vk::SamplerAddressMode,
    pub address_mode_v: vk::SamplerAddressMode,
}

#[derive(Debug)]
pub struct NodeDesc {
    pub index: usize,
    pub name: Option<String>,
    pub parent: Option<usize>,
    pub children: Vec<usize>,
    pub mesh: Option<usize>,
    pub camera: Option<usize>,
    pub transform: Mat4,
}

#[derive(Debug)]
pub struct GltfDocument {
    pub materials: Vec<MaterialDesc>,
    pub samplers: Vec<SamplerDesc>,
    pub textures: Vec<TextureDesc>,
    pub meshes: Vec<MeshDesc>,
    pub scene: SceneDesc,
    pub document: gltf::Document,
    pub buffers: Vec<gltf::buffer::Data>,
    pub images: Vec<gltf::image::Data>,
}

#[derive(Debug)]
pub struct SceneDesc {
    pub roots: Vec<usize>,
    pub nodes: Vec<NodeDesc>,
}

const GLTF_SAMPLE_DIR: &str = "assets/gltf/glTF-Sample-Assets";
const GLTF_VALIDATION_DIR: &str = "assets/gltf/gltf-Asset-Validator";

pub fn load_sample_scene(name: &str) -> Result<GltfDocument> {
    let path = format!("{GLTF_SAMPLE_DIR}/{name}/glTF/{name}.gltf");
    let path = std::path::Path::new(&path);

    if std::path::Path::new(&path).exists() {
        return load(&path.to_string_lossy());
    }

    let path = format!("{GLTF_SAMPLE_DIR}/{name}/glTF-Binary/{name}.glb");
    load(&path)
}
pub fn load(path: &str) -> Result<GltfDocument> {
    let (document, buffers, images) = gltf::import(path)?;
    let samplers = read_samplers(&document);
    let textures = read_textures(&document, &images);
    let materials = read_materials(&document);
    let _boxed = black_box(&materials);

    let meshes = read_meshes(&document, &buffers);
    let scene = read_scene(&document);

    Ok(GltfDocument {
        samplers,
        textures,
        meshes,
        materials,
        scene,
        document,
        buffers,
        images,
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
            let wrap_s = sampler.wrap_s();
            let wrap_t = sampler.wrap_t();

            SamplerDesc {
                index: i as usize,
                min_filter: convert_min_filter(min_filter),
                mag_filter: convert_mag_filter(mag_filter),
                mipmap_mode: convert_mipmap_mode(min_filter),
                address_mode_u: convert_wrap(wrap_s),
                address_mode_v: convert_wrap(wrap_t),
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
            let f = image.format;
            let s = document.images().nth(i).unwrap().source();
            match s {
                gltf::image::Source::View { view, mime_type } => {
                    log::debug!("image (view) {i} -> format: {f:?}, mime type {:?}", mime_type)
                }
                gltf::image::Source::Uri { uri, mime_type } => {
                    log::debug!("image (uri) {i} -> format: {f:?}, mime type {mime_type:?}, uri: {uri}")
                }
            }

            log::debug!("texture {i} format {:?}", image.format);
            TextureDesc {
                name: format!("gltf-texture-{i}"),
                data: image.pixels.clone(),
                extent: Extent2D {
                    width: image.width,
                    height: image.height,
                },
                gltf_format: image.format,
                format: convert_format(image.format),
                index: texture.index() as usize,
            }
        })
        .collect()
}

pub fn read_materials(document: &gltf::Document) -> Vec<MaterialDesc> {
    document
        .materials()
        .enumerate()
        .map(|(i, material)| {
            let pbr = material.pbr_metallic_roughness();

            let base_texture = pbr.base_color_texture().map(|i| i.texture());
            let base_sampler = base_texture.as_ref().map(|t| t.sampler());
            let normal = material.normal_texture().map(|i| i.texture());
            let normal_sampler = normal.as_ref().map(|t| t.sampler());
            let occlusion = material.occlusion_texture().map(|i| i.texture());
            let occlusion_sampler = occlusion.as_ref().map(|t| t.sampler());
            let metallic = pbr.metallic_roughness_texture().map(|i| i.texture());
            let metallic_sampler = metallic.as_ref().map(|t| t.sampler());

            let name = format!("gltf-material{i}");

            MaterialDesc {
                name: name.to_string(),
                base_color_tx: base_texture.map(|i| i.index()),
                base_color_factor: pbr.base_color_factor(),
                base_color_sampler: base_sampler.and_then(|s| s.index()),
                normal_texture: normal.map(|i| i.index()),
                normal_sampler: normal_sampler.and_then(|s| s.index()),
                occlusion_sampler: occlusion_sampler.and_then(|s| s.index()),
                occlusion_texture: occlusion.map(|i| i.index()),
                metallic_roughnness_texture: metallic.map(|i| i.index()),
                metallic_roughness_sampler: metallic_sampler.and_then(|s| s.index()),
                metallic_factor: pbr.metallic_factor(),
                roughness_factor: pbr.roughness_factor(),
            }
        })
        .collect()
}

pub fn read_meshes(document: &gltf::Document, buffers: &[gltf::buffer::Data]) -> Vec<MeshDesc> {
    let meshes = document
        .meshes()
        .enumerate()
        .map(|(i, mesh)| {
            let primitives: Vec<_> = mesh
                .primitives()
                .enumerate()
                .map(|(j, primitive)| {
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
                    let tangents = reader
                        .read_tangents()
                        .map_or(Vec::new(), |tangents| tangents.map(Vec4::from).collect());
                    let colors = reader.read_colors(0).map_or(Vec::new(), |colors| {
                        colors.into_rgba_f32().map(Vec4::from).collect::<Vec<_>>()
                    });

                    let vertices = positions
                        .iter()
                        .enumerate()
                        .map(|(index, position)| {
                            let uv = *tex_coords_0.get(index).unwrap_or(&Vec2::ZERO);
                            let color = *colors.get(index).unwrap_or(&Vec4::ONE);

                            let v = Vertex {
                                position: *position,
                                normal: *normals.get(index).unwrap_or(&Vec3::ZERO),
                                uv_x: uv.x,
                                uv_y: uv.y,
                                tangent: *tangents.get(index).unwrap_or(&Vec4::ZERO),
                                color,
                                normal_derived: Vec3::ZERO,
                                _padding: 0.0,
                            };

                            v
                        })
                        .collect();
                    let indices = reader
                        .read_indices()
                        .map(|read_indices| read_indices.into_u32().collect::<Vec<_>>())
                        .unwrap();

                    PrimitiveDesc {
                        name: format!("gltf-mesh{i}-primitive{j}"),
                        material: primitive.material().index(),
                        colors,
                        vertices,
                        tangents,
                        indices,
                    }
                })
                .collect();
            MeshDesc {
                name: format!("gltf-mesh{i}"),
                index: i,
                primitives: primitives,
            }
        })
        .collect();

    meshes
}

pub fn read_scene(document: &gltf::Document) -> SceneDesc {
    let scene = document
        .default_scene()
        .expect("No scene found in glTF document");
    let nodes: Vec<_> = scene
        .nodes()
        .flat_map(|node| read_node(node, None))
        .collect();
    let roots = scene.nodes().map(|node| node.index()).collect();

    SceneDesc { roots, nodes }
}

fn read_node(node: gltf::Node, parent_idx: Option<usize>) -> Vec<NodeDesc> {
    let index = node.index();
    let transform = match node.transform() {
        gltf::scene::Transform::Matrix { matrix } => Mat4::from_cols_array_2d(&matrix),
        gltf::scene::Transform::Decomposed {
            translation,
            rotation,
            scale,
        } => {
            let translation = Vec3::from(translation);
            let rotation = Quat::from_array(rotation);
            let scale = Vec3::from(scale);
            Mat4::from_scale_rotation_translation(scale, rotation, translation)
        }
    };
    let mut nodes = vec![NodeDesc {
        index,
        parent: parent_idx,
        name: node.name().map(|s| s.to_string()),
        children: node.children().map(|child| child.index()).collect(),
        mesh: node.mesh().map(|mesh| mesh.index()),
        camera: node.camera().map(|camera| camera.index()),
        transform: transform,
    }];
    for child in node.children() {
        let child_nodes = read_node(child, Some(index));
        nodes.extend(child_nodes);
    }
    nodes
}

fn convert_wrap(wrap: gltf::texture::WrappingMode) -> vk::SamplerAddressMode {
    match wrap {
        gltf::texture::WrappingMode::ClampToEdge => vk::SamplerAddressMode::CLAMP_TO_EDGE,
        gltf::texture::WrappingMode::MirroredRepeat => vk::SamplerAddressMode::MIRRORED_REPEAT,
        gltf::texture::WrappingMode::Repeat => vk::SamplerAddressMode::REPEAT,
    }
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
        gltf::image::Format::R8G8B8 => vk::Format::R8G8B8A8_SRGB,
        gltf::image::Format::R8G8B8A8 => vk::Format::R8G8B8A8_SRGB,
        gltf::image::Format::R16 => vk::Format::R16_UNORM,
        gltf::image::Format::R16G16 => vk::Format::R16G16_UNORM,
        gltf::image::Format::R16G16B16 => vk::Format::R16G16B16_SFLOAT,
        gltf::image::Format::R16G16B16A16 => vk::Format::R16G16B16A16_SFLOAT,
        gltf::image::Format::R32G32B32FLOAT => vk::Format::R32G32B32_SFLOAT,
        gltf::image::Format::R32G32B32A32FLOAT => vk::Format::R32G32B32A32_SFLOAT,
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic() {
        let gltf =
            load("../../assets/gltf/suzanne/Suzanne.gltf").expect("Failed to load test glTF file");
        assert_eq!(gltf.samplers.len(), 1);
        assert_eq!(gltf.textures.len(), 4);
        assert_eq!(gltf.materials.len(), 1);
        assert_eq!(gltf.meshes.len(), 1);
        assert_eq!(gltf.scene.roots.len(), 1);
    }
}
