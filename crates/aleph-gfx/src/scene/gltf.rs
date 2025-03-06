use {
    super::{
        assets::AssetHandle,
        model::{GpuDrawData, Mesh, Vertex},
        util, AssetCache,
    },
    crate::{
        scene::{assets::Material, model::Primitive},
        vk::{Gpu, Texture},
    },
    anyhow::Result,
    ash::vk::{self, Extent2D, Filter, ImageAspectFlags, ImageUsageFlags, SamplerMipmapMode},
    derive_more::Debug,
    glam::{Mat4, Vec2, Vec3, Vec4},
    image::{DynamicImage, RgbImage, RgbaImage},
    petgraph::{graph::NodeIndex, prelude::*, visit::Dfs},
    std::mem,
};

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
type GltfTextureData = gltf::image::Data;
type GltfTextureInfo<'a> = gltf::Texture<'a>;

#[derive(Debug)]
pub struct Scene {
    pub children: Vec<Graph>,
}

struct GltfNodeContext<'a> {
    pub gpu: &'a Gpu,
    pub materials: Vec<AssetHandle>,
    pub buffers: Vec<gltf::buffer::Data>,
}

struct GltfMaterialContext<'a> {
    pub gpu: &'a Gpu,
    pub samplers: &'a Vec<vk::Sampler>,
    pub texture_data: Vec<GltfTextureData>,
    pub document: &'a gltf::Document,
    pub defaults: &'a GltfDefaults,
}

struct GltfDefaults {
    pub sampler: vk::Sampler,
    pub base_color_texture: Texture,
    pub normal_texture: Texture,
    pub occlusion_texture: Texture,
}

impl Mesh {}

pub fn load_gltf(path: &str, gpu: &Gpu, assets: &mut AssetCache) -> Result<Vec<Scene>> {
    let defaults = GltfDefaults {
        sampler: gpu.create_sampler(Filter::NEAREST, Filter::NEAREST, SamplerMipmapMode::NEAREST)?,
        base_color_texture: util::single_color_image(gpu, [1.0, 1.0, 1.0, 1.0], "default base color")?,
        normal_texture: util::single_color_image(gpu, [0.5, 0.5, 1.0, 1.0], "default normal")?,
        occlusion_texture: util::single_color_image(
            gpu,
            [1.0, 1.0, 1.0, 1.0],
            "default occlusion",
        )?,
    };

    let (document, buffers, images) = gltf::import(path)?;
    let samplers = load_samplers(gpu, &document)?;
    let context = GltfMaterialContext {
        gpu,
        document: &document,
        samplers: &samplers,
        texture_data: images,
        defaults: &defaults,
    };
    let materials = load_materials(&context, assets)?;
    let context = GltfNodeContext {
        gpu,
        materials,
        buffers,
    };

    let scenes: Vec<Scene> = document
        .scenes()
        .map(|scene| load_scene(&context, scene))
        .collect();

    Ok(scenes)
}

fn factor_to_vec(f: f32) -> [f32; 4] { [f, f, f, f] }

pub fn load_samplers(gpu: &Gpu, gltf: &gltf::Document) -> Result<Vec<vk::Sampler>> {
    let mut samplers = vec![];
    for sampler in gltf.samplers() {
        let min_filter = sampler
            .min_filter()
            .unwrap_or(gltf::texture::MinFilter::Nearest);
        let mag_filter = sampler
            .mag_filter()
            .unwrap_or(gltf::texture::MagFilter::Nearest);

        let sampler = gpu.create_sampler(
            convert_min_filter(min_filter),
            convert_mag_filter(mag_filter),
            convert_mipmap_mode(min_filter),
        )?;
        samplers.push(sampler);
    }
    Ok(samplers)
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

fn load_or_default(
    gpu: &Gpu,
    info: Option<GltfTextureInfo>,
    texture_datas: &[GltfTextureData],
    samplers: &[vk::Sampler],
    label: String,
    default_texture: &Texture,
    default_sampler: &vk::Sampler,
) -> Result<(Texture, vk::Sampler)> {
    match info {
        Some(info) => {
            let index = info.index();
            let data = texture_datas[index].clone();
            let format = data.format;
            let extent = Extent2D {
                width: data.width,
                height: data.height,
            };

            let texture = create_and_upload_texture(
                gpu,
                data.pixels.clone(),
                extent,
                format,
                label.to_string(),
            )?;
            let sampler = match info.sampler().index() {
                Some(i) => samplers[i],
                None => *default_sampler,
            };

            Ok((texture, sampler))
        }
        None => Ok((default_texture.clone(), *default_sampler)),
    }
}

fn load_materials(
    context: &GltfMaterialContext,
    assets: &mut AssetCache,
) -> Result<Vec<AssetHandle>> {
    let defaults = &context.defaults;
    let gpu = context.gpu;
    let gltf = context.document;
    let texture_data = &context.texture_data;
    let mut handles = vec![];

    for (i, material_data) in gltf.materials().enumerate() {
        let pbr = material_data.pbr_metallic_roughness();
        let metallic_factor = pbr.metallic_factor();
        let material_id = pbr.roughness_factor();
        let label = format!("gltf-material-{i}");

        let (base_color_texture, base_color_sampler) = load_or_default(
            gpu,
            pbr.base_color_texture().map(|t| t.texture()),
            &context.texture_data,
            context.samplers,
            format!("gltf-material-{i}-base-color"),
            &defaults.base_color_texture,
            &defaults.sampler,
        )?;
        let (normal_texture, normal_sampler) = load_or_default(
            gpu,
            material_data.normal_texture().map(|t| t.texture()),
            &context.texture_data,
            context.samplers,
            format!("gltf-material-{i}-normal"),
            &defaults.normal_texture,
            &defaults.sampler,
        )?;
        let (occlusion_texture, occlusion_sampler) = load_or_default(
            gpu,
            material_data.occlusion_texture().map(|t| t.texture()),
            &context.texture_data,
            context.samplers,
            format!("gltf-material-{i}-occlusion"),
            &defaults.occlusion_texture,
            &defaults.sampler,
        )?;

        let metallic_roughness_info = pbr.metallic_roughness_texture();
        let metallic_label = format!("{label}-metallic");
        let roughness_label = format!("{label}-roughness");
        let (metallic_texture, roughness_texture, metallic_roughness_sampler) =
            match metallic_roughness_info {
                Some(info) => {
                    let source = texture_data[info.texture().index()].clone();
                    let metallic = extract_color_channel(gpu, 0, &source, metallic_label)?;
                    let roughness = extract_color_channel(gpu, 1, &source, roughness_label)?;
                    let sampler = match info.texture().sampler().index() {
                        Some(i) => context.samplers[i],
                        None => defaults.sampler,
                    };
                    (metallic, roughness, sampler)
                }
                None => {
                    let metallic_factor = factor_to_vec(metallic_factor);
                    let metallic = util::single_color_image(
                        gpu,
                        metallic_factor,
                        metallic_label,
                    )?;
                    let roughness_factor = factor_to_vec(material_id);
                    let roughness = util::single_color_image(
                        gpu,
                        roughness_factor,
                        roughness_label
                    )?;
                    (metallic, roughness, defaults.sampler)
                }
            };

        let material = Material {
            base_color_texture,
            base_color_sampler,
            metallic_texture,
            roughness_texture,
            metallic_factor,
            metallic_roughness_sampler,
            normal_sampler,
            normal_texture,
            roughness_factor: material_id,
            occlusion_texture,
            occlusion_sampler,
        };

        let handle = assets.add_material(material);
        handles.push(handle)
    }

    Ok(handles)
}

fn extract_color_channel(gpu: &Gpu, index: usize, data: &GltfTextureData, label: String) -> Result<Texture> {
    let pixels = data.pixels.clone();
    let mut bytes = vec![];
    for i in (0..pixels.len()).step_by(4) {
        bytes.push(pixels[i + index]);
    }
    let extent = Extent2D {
        width: 1,
        height: 1,
    };
    create_and_upload_texture(
        gpu,
        pixels,
        extent,
        gltf::image::Format::R8G8B8A8,
        label,
    )
}

fn load_scene(context: &GltfNodeContext, scene_data: gltf::Scene) -> Scene {
    let mut children: Vec<Graph> = vec![];
    for node in scene_data.nodes() {
        let mut node_graph = Graph::new();
        load_node(context, &node, &mut node_graph, NodeIndex::new(0));
        children.push(node_graph);
    }
    Scene { children }
}

pub fn create_and_upload_texture(
    gpu: &Gpu,
    data: Vec<u8>,
    extent: Extent2D,
    format: gltf::image::Format,
    label: String,
) -> Result<Texture> {
    let width = extent.width;
    let height = extent.height;
    let image = match format {
        gltf::image::Format::R8G8B8A8 => {
            RgbaImage::from_raw(width, height, data).map(DynamicImage::ImageRgba8)
        }
        gltf::image::Format::R8G8B8 => {
            RgbImage::from_raw(width, height, data).map(DynamicImage::ImageRgb8)
        }

        _ => unimplemented!("Unsupported format: {:?}", format),
    };
    let image = image.ok_or_else(|| anyhow::anyhow!("Failed to create image from data"))?;
    let format = to_vk_format(format);
    let texture = gpu.create_image(
        extent,
        format,
        ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
        ImageAspectFlags::COLOR,
        label,
    )?;
    let staging = util::staging_buffer(gpu, image.as_bytes(), "staging")?;
    gpu.execute(|cmd| {
        cmd.copy_buffer_to_image(&staging, &texture);
    })?;
    Ok(texture)
}

fn load_node(
    context: &GltfNodeContext,
    node: &gltf::Node,
    graph: &mut Graph,
    parent_index: NodeIndex,
) {
    let info = {
        match node.mesh() {
            Some(mesh) => Node::Mesh {
                local_transform: build_transform(node),
                mesh: load_mesh(context, &mesh).unwrap(),
                index: node.index(),
            },
            None => Node::Group,
        }
    };
    let index = graph.add_node(info);
    if parent_index != index {
        graph.add_edge(parent_index, index, ());
    }

    for child in node.children() {
        load_node(context, &child, graph, index);
    }
}

fn load_mesh(context: &GltfNodeContext, mesh: &gltf::Mesh) -> Option<Mesh> {
    let mut all_primitive_info = Vec::new();
    for info in mesh.primitives() {
        let (vertices, indices) = load_geometry(&info, &context.buffers);
        let mut primitive = load_primitive(context, &info, &vertices, &indices).unwrap();
        let material_index = info.material().index();
        primitive.material_index = material_index;
        all_primitive_info.push(primitive);
    }
    let mesh = Mesh {
        primitives: all_primitive_info,
    };
    log::debug!("Loaded mesh: {:?}", mesh);
    Some(mesh)
}

fn build_transform(node: &gltf::Node) -> Mat4 {
    let transform: Vec<f32> = node
        .transform()
        .matrix()
        .iter()
        .flat_map(|array| array.iter())
        .cloned()
        .collect();
    Mat4::from_cols_slice(&transform)
}

fn load_geometry(
    primitive: &gltf::Primitive,
    buffers: &[gltf::buffer::Data],
) -> (Vec<Vertex>, Vec<u32>) {
    let reader = primitive.reader(|buffer| Some(&buffers[buffer.index()]));

    let positions = reader.read_positions().map_or(Vec::new(), |positions| {
        positions.map(Vec3::from).collect::<Vec<_>>()
    });

    let normals = reader.read_normals().map_or(Vec::new(), |normals| {
        normals.map(Vec3::from).collect::<Vec<_>>()
    });

    let convert_coords = |coords: gltf::mesh::util::ReadTexCoords<'_>| -> Vec<Vec2> {
        coords.into_f32().map(Vec2::from).collect::<Vec<_>>()
    };
    let tex_coords_0 = reader.read_tex_coords(0).map_or(Vec::new(), convert_coords);
    let tex_coords_1 = reader.read_tex_coords(1).map_or(Vec::new(), convert_coords);

    let mut vertices = Vec::new();
    for (index, position) in positions.iter().enumerate() {
        vertices.push(Vertex {
            position: *position,
            normal: *normals.get(index).unwrap_or(&Vec3::ZERO),
            tex_coords_0: *tex_coords_0.get(index).unwrap_or(&Vec2::ZERO),
            tex_coords_1: *tex_coords_1.get(index).unwrap_or(&Vec2::ZERO),
            color: Vec4::ONE,
            _padding1: 0.,
            _padding2: 0.,
        });
    }

    let indices = reader
        .read_indices()
        .map(|read_indices| read_indices.into_u32().collect::<Vec<_>>())
        .unwrap();
    (vertices, indices)
}

fn load_primitive(
    context: &GltfNodeContext,
    info: &gltf::mesh::Primitive,
    vertices: &[Vertex],
    indices: &[u32],
) -> Result<Primitive> {
    let material_index = info.material().index();
    let gpu = context.gpu;
    let index_buffer_size = mem::size_of::<u32>() as u64 * indices.len() as u64;
    let index_buffer = util::index_buffer(gpu, index_buffer_size, "index buffer")?;
    let index_staging = util::staging_buffer(gpu, indices, "index staging")?;

    let vertex_buffer_size = mem::size_of::<Vertex>() as u64 * vertices.len() as u64;
    let vertex_buffer = util::vertex_buffer(gpu, vertex_buffer_size, "vertex buffer")?;
    let vertex_staging = util::staging_buffer(gpu, vertices, "vertex staging")?;

    gpu.execute(|cmd| {
        cmd.copy_buffer(&vertex_staging, &vertex_buffer, vertex_buffer.size());
        cmd.copy_buffer(&index_staging, &index_buffer, index_buffer.size());
    })?;

    let vertex_count = indices.len() as u32;
    let model_buffer = gpu.create_shared_buffer::<GpuDrawData>(
        mem::size_of::<GpuDrawData>() as u64,
        vk::BufferUsageFlags::UNIFORM_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
        "model buffer",
    )?;
    let material = material_index.map(|index| context.materials[index]);

    let primitive = Primitive {
        vertex_buffer,
        index_buffer,
        material_index,
        vertex_count,
        model_buffer,
        material,
        model_matrix: Mat4::IDENTITY,
    };
    log::debug!("Loaded primitive: {:?}", primitive);
    Ok(primitive)
}

pub fn path_between_nodes(
    starting_node_index: NodeIndex,
    node_index: NodeIndex,
    graph: &Graph,
) -> Vec<NodeIndex> {
    let mut indices = Vec::new();
    let mut dfs = Dfs::new(&graph, starting_node_index);
    while let Some(current_node_index) = dfs.next(&graph) {
        let mut incoming_walker = graph
            .neighbors_directed(current_node_index, Incoming)
            .detach();
        let mut outgoing_walker = graph
            .neighbors_directed(current_node_index, Outgoing)
            .detach();

        if let Some(parent) = incoming_walker.next_node(graph) {
            while let Some(last_index) = indices.last() {
                if *last_index == parent {
                    break;
                }
                // Discard indices for transforms that are no longer needed
                indices.pop();
            }
        }

        indices.push(current_node_index);

        if node_index == current_node_index {
            break;
        }

        // If the node has no children, don't store the index
        if outgoing_walker.next(graph).is_none() {
            indices.pop();
        }
    }
    indices
}

fn to_vk_format(format: gltf::image::Format) -> vk::Format {
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
