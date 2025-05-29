use {
    crate::{Material, MeshInfo, Vertex},
    aleph_vk::{
        sync, AccessFlags2, Buffer, CommandBuffer, DescriptorBufferInfo, DescriptorImageInfo,
        DescriptorPool, DescriptorSet, DescriptorSetLayout, DescriptorType, Device, Extent2D,
        Filter, Format, Gpu, ImageAspectFlags, ImageLayout, ImageUsageFlags, PipelineStageFlags2,
        ResourcePool, Sampler, SamplerAddressMode, SamplerMipmapMode, ShaderStageFlags, Texture,
        TextureInfo, TypedBuffer, WriteDescriptorSet,
    },
    anyhow::{bail, Result},
    bytemuck::{Pod, Zeroable},
    derive_more::Debug,
    glam::{vec4, Vec4},
    image::{ImageBuffer, Rgba},
    std::{
        collections::HashMap,
        hash::{Hash, Hasher},
        rc::Rc,
        sync::{
            atomic::{AtomicU64, Ordering},
            Arc,
        },
    },
    tracing::instrument,
};

const WHITE: [u8; 4] = [255, 255, 255, 255];
const NORMAL: [u8; 4] = [127, 127, 255, 255];
static ASSET_HANDLE_COUNTER: AtomicU64 = AtomicU64::new(1);
const STAGING_POOL_SIZE: usize = 10;
const STAGING_POOL_RETENTION: usize = 5;
const DEFAULT_EXTENT: Extent2D = Extent2D {
    width: 8,
    height: 8,
};

pub struct AssetHandle<T> {
    index: u64,
    marker: std::marker::PhantomData<T>,
}

impl<T> Default for AssetHandle<T> {
    fn default() -> Self { Self::null() }
}

impl<T> AssetHandle<T> {
    pub fn new() -> Self {
        let index = ASSET_HANDLE_COUNTER.fetch_add(1, Ordering::Relaxed);
        Self {
            index,
            marker: std::marker::PhantomData,
        }
    }

    pub fn null() -> Self {
        Self {
            index: 0,
            marker: std::marker::PhantomData,
        }
    }
}

impl<T> Debug for AssetHandle<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Asset({})", self.index)
    }
}
impl<T> Copy for AssetHandle<T> {}

impl<T> Clone for AssetHandle<T> {
    fn clone(&self) -> Self {
        Self {
            index: self.index,
            marker: std::marker::PhantomData,
        }
    }
}

impl<T> Hash for AssetHandle<T> {
    fn hash<H: Hasher>(&self, state: &mut H) { self.index.hash(state) }
}

impl<T> PartialEq for AssetHandle<T> {
    fn eq(&self, other: &Self) -> bool { self.index == other.index }
}

impl<T> Eq for AssetHandle<T> {}

pub type MeshHandle = AssetHandle<MeshInfo>;
pub type TextureHandle = AssetHandle<Texture>;
pub type MaterialHandle = AssetHandle<Material>;

type AssetCache<T> = HashMap<AssetHandle<T>, T>;

#[derive(Debug)]
enum AsyncAsset<T, I, D> {
    Loaded(Rc<T>),
    Unloaded(I, D),
}
type TextureAsset = AsyncAsset<Texture, TextureInfo, Vec<u8>>;
type AsyncCache<T, I, D> = HashMap<AssetHandle<T>, AsyncAsset<T, I, D>>;

#[derive(Debug)]
pub struct Assets {
    texture_loader: TextureLoader,
    meshes: AssetCache<MeshInfo>,
    textures: AsyncCache<Texture, TextureInfo, Vec<u8>>,
    materials: AssetCache<Material>,
    default_material: Material,
    default_sampler: Sampler,
}

impl Assets {
    pub fn new(gpu: Arc<Gpu>) -> Result<Self> {
        let default_sampler = Sampler::default(&gpu.device())?;
        let texture_loader = TextureLoader::new(gpu.clone());

        let mut assets = Self {
            texture_loader,
            meshes: HashMap::new(),
            textures: HashMap::new(),
            materials: HashMap::new(),
            default_material: Material::default(),
            default_sampler,
        };
        assets.default_material = assets.create_default_material()?.1;

        Ok(assets)
    }

    pub fn update(&mut self) { self.texture_loader.update(); }

    pub fn default_sampler(&self) -> Sampler { self.default_sampler.clone() }

    pub fn create_sampler(
        &self,
        name: &str,
        min_filter: Filter,
        mag_filter: Filter,
        mipmap_mode: SamplerMipmapMode,
        address_mode_u: SamplerAddressMode,
        address_mode_v: SamplerAddressMode,
    ) -> Sampler {
        let sampler = Sampler::new(
            &self.texture_loader.gpu.device(),
            min_filter,
            mag_filter,
            mipmap_mode,
            address_mode_u,
            address_mode_v,
            name,
        )
        .unwrap_or_else(|e| panic!("Failed to create sampler: {}", e));
        sampler
    }

    fn create_default_texture(&mut self, color: &[u8; 4], format: Format) -> TextureHandle {
        let data = {
            let pixel = Rgba::<u8>(*color);
            ImageBuffer::from_pixel(DEFAULT_EXTENT.width, DEFAULT_EXTENT.height, pixel)
        };
        let info = TextureInfo {
            name: "default".to_string(),
            extent: DEFAULT_EXTENT,
            flags: ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
            aspect_flags: ImageAspectFlags::COLOR,
            format,
            sampler: Some(self.default_sampler.clone()),
        };
        self.add_texture(info, &data)
    }

    fn create_default_material(&mut self) -> Result<(MaterialHandle, Material)> {
        let color_texture = self.create_default_texture(&WHITE, Format::R8G8B8A8_SRGB);
        let normal_texture = self.create_default_texture(&NORMAL, Format::R8G8B8A8_UNORM);
        let metalrough_texture = self.create_default_texture(&WHITE, Format::R8G8B8A8_UNORM);
        let ao_texture = self.create_default_texture(&WHITE, Format::R8G8B8A8_UNORM);

        let material = Material {
            name: "default".to_string(),
            color_texture,
            color_factor: vec4(1., 1., 1., 1.),
            normal_texture,
            metalrough_texture,
            metallic_factor: 1.0,
            roughness_factor: 1.0,
            occlusion_texture: ao_texture,
            ao_strength: 1.0,
        };

        let handle = self.add_material(material.clone());
        Ok((handle, material))
    }

    pub fn add_texture(&mut self, info: TextureInfo, data: &[u8]) -> TextureHandle {
        let handle = TextureHandle::new();
        let asset = TextureAsset::Unloaded(info, data.to_vec());
        self.textures.insert(handle, asset);
        handle
    }

    fn get_or_load_texture(
        &mut self,
        handle: &TextureHandle,
        cmd: Option<&CommandBuffer>,
    ) -> Option<Rc<Texture>> {
        match self.textures.get(&handle) {
            Some(asset) => match asset {
                TextureAsset::Loaded(texture) => Some(Rc::clone(texture)),
                TextureAsset::Unloaded(info, data) => {
                    let rc = Rc::new(
                        self.texture_loader.load_texture(&info, data, cmd.unwrap()).unwrap(),
                    );
                    let asset = TextureAsset::Loaded(rc.clone());
                    self.textures.insert(*handle, asset);
                    Some(rc)
                }
            },
            None => None,
        }
    }

    pub fn add_material(&mut self, material: Material) -> MaterialHandle {
        let handle = MaterialHandle::new();
        let mut material = material.clone();
        if material.color_texture == TextureHandle::null() {
            material.color_texture = self.default_material.color_texture;
        }
        if material.normal_texture == TextureHandle::null() {
            material.normal_texture = self.default_material.normal_texture;
        }
        if material.metalrough_texture == TextureHandle::null() {
            material.metalrough_texture = self.default_material.metalrough_texture;
        }
        if material.occlusion_texture == TextureHandle::null() {
            material.occlusion_texture = self.default_material.occlusion_texture;
        }
        self.materials.insert(handle, material);
        handle
    }

    pub fn get_material(&self, handle: MaterialHandle) -> Option<&Material> {
        self.materials.get(&handle)
    }

    pub fn add_mesh(&mut self, info: MeshInfo) -> MeshHandle {
        let handle = MeshHandle::new();
        self.meshes.insert(handle, info);
        handle
    }

    pub fn get_mesh(&mut self, handle: MeshHandle) -> Option<&MeshInfo> { self.meshes.get(&handle) }

    pub fn prepare_bindless(&mut self, cmd: &CommandBuffer) -> Result<BindlessData> {
        let mut textures = Vec::new();
        let mut texture_map = HashMap::new();
        for handle in self.textures.keys().cloned().collect::<Vec<_>>() {
            let texture = match self.get_or_load_texture(&handle, Some(cmd)) {
                Some(texture) => texture,
                None => bail!("Texture {:?} not found", handle),
            };
            textures.push(texture);
            texture_map.insert(handle, textures.len() - 1);
        }

        let mut meshes = Vec::new();
        let mut mesh_map = HashMap::new();
        for (handle, mesh) in self.meshes.iter() {
            meshes.push(mesh.clone());
            mesh_map.insert(*handle, meshes.len() - 1);
        }

        let mut materials = Vec::new();
        let mut material_map = HashMap::new();

        let texture_index =
            |handle| texture_map.get(&handle).map(|&index| index as u32).unwrap_or(0);

        for (handle, material) in self.materials.iter() {
            materials.push(GpuMaterial {
                color_texture: texture_index(material.color_texture),
                normal_texture: texture_index(material.normal_texture),
                metalrough_texture: texture_index(material.metalrough_texture),
                occlusion_texture: texture_index(material.occlusion_texture),
                color_factor: material.color_factor,
                metallic_factor: material.metallic_factor,
                roughness_factor: material.roughness_factor,
                ao_strength: material.ao_strength,
                padding0: 0.,
            });
            material_map.insert(*handle, materials.len() - 1);
        }

        Ok(BindlessData {
            textures,
            texture_map,
            meshes,
            mesh_map,
            materials,
            material_map,
        })
    }
}

#[derive(Debug)]
struct TextureLoader {
    gpu: Arc<Gpu>,
    staging_pool: ResourcePool<Buffer>,
}

impl TextureLoader {
    fn new(gpu: Arc<Gpu>) -> Self {
        let staging_pool =
            ResourcePool::<Buffer>::new(&gpu, STAGING_POOL_SIZE, STAGING_POOL_RETENTION);
        Self { gpu, staging_pool }
    }

    fn update(&mut self) { self.staging_pool.update(); }

    fn load_texture(
        &self,
        info: &TextureInfo,
        data: &[u8],
        cmd: &CommandBuffer,
    ) -> Result<Texture> {
        let texture = Texture::new(&self.gpu, info)?;
        let data = bytemuck::cast_slice(data);
        let staging = self.staging_pool.next();
        staging.write(data);

        let memory_range = staging.mapped_memory_range();
        self.gpu.device().flush_mapped_memory_ranges(&[memory_range]);

        cmd.pipeline_barrier(
            &[],
            &[],
            &[sync::image_memory_barrier(
                &*texture,
                PipelineStageFlags2::NONE,
                AccessFlags2::NONE,
                PipelineStageFlags2::TRANSFER,
                AccessFlags2::TRANSFER_WRITE,
                ImageLayout::UNDEFINED,
                ImageLayout::TRANSFER_DST_OPTIMAL,
            )],
        );

        cmd.copy_buffer_to_image(&staging, &texture);

        cmd.pipeline_barrier(
            &[],
            &[],
            &[sync::image_memory_barrier(
                &*texture,
                PipelineStageFlags2::TRANSFER,
                AccessFlags2::TRANSFER_WRITE,
                PipelineStageFlags2::FRAGMENT_SHADER,
                AccessFlags2::SHADER_READ,
                ImageLayout::TRANSFER_DST_OPTIMAL,
                ImageLayout::SHADER_READ_ONLY_OPTIMAL,
            )],
        );

        Ok(texture)
    }
}

pub struct BindlessData {
    pub textures: Vec<Rc<Texture>>,
    pub texture_map: HashMap<TextureHandle, usize>,
    pub meshes: Vec<MeshInfo>,
    pub mesh_map: HashMap<MeshHandle, usize>,
    pub materials: Vec<GpuMaterial>,
    pub material_map: HashMap<MaterialHandle, usize>,
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuMaterial {
    pub color_factor: Vec4,
    pub color_texture: u32,
    pub normal_texture: u32,
    pub metallic_factor: f32,
    pub roughness_factor: f32,
    pub metalrough_texture: u32,
    pub ao_strength: f32,
    pub occlusion_texture: u32,
    pub padding0: f32,
}
