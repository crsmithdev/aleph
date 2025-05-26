use {
    crate::{model::MeshInfo, Material},
    aleph_vk::{
        sync, AccessFlags2, Buffer, CommandBuffer, Extent2D, Filter, Format, Gpu, ImageAspectFlags,
        ImageLayout, ImageUsageFlags, PipelineStageFlags2, ResourcePool, Sampler,
        SamplerAddressMode, SamplerMipmapMode, Texture, TextureInfo,
    },
    anyhow::Result,
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

#[derive(Debug, Default)]
struct Asset<T>(Rc<T>);

type AssetCache<T> = HashMap<AssetHandle<T>, Asset<T>>;
type AssetCache2<T> = HashMap<AssetHandle<T>, T>;

#[derive(Debug)]
enum AsyncAsset<T, I, D> {
    Loaded(Rc<T>),
    Unloaded(I, D),
}
type TextureAsset2 = AsyncAsset<Texture, TextureInfo, Vec<u8>>;
type AsyncCache<T, I, D> = HashMap<AssetHandle<T>, AsyncAsset<T, I, D>>;

#[derive(Debug)]
pub struct Assets {
    gpu: Arc<Gpu>,
    texture_loader: TextureLoader,
    meshes: AssetCache2<MeshInfo>,
    textures: AsyncCache<Texture, TextureInfo, Vec<u8>>,
    materials: AssetCache<Material>,
    default_material: Material,
    default_sampler: Sampler,
}

impl Assets {
    pub fn new(gpu: Arc<Gpu>) -> Result<Self> {
        let default_sampler = gpu.create_sampler(
            Filter::LINEAR,
            Filter::LINEAR,
            SamplerMipmapMode::LINEAR,
            SamplerAddressMode::REPEAT,
            SamplerAddressMode::REPEAT,
        )?;

        let texture_loader = TextureLoader::new(gpu.clone());

        let mut assets = Self {
            gpu: Arc::clone(&gpu),
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

    pub fn default_sampler(&self) -> Sampler { self.default_sampler }

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
            ao_texture,
            ao_strength: 1.0,
        };

        let handle = self.add_material(material.clone());
        Ok((handle, material))
    }

    pub fn add_texture(&mut self, info: TextureInfo, data: &[u8]) -> TextureHandle {
        let handle = TextureHandle::new();
        let asset = TextureAsset2::Unloaded(info, data.to_vec());
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
                TextureAsset2::Loaded(texture) => Some(Rc::clone(texture)),
                TextureAsset2::Unloaded(info, data) => {
                    let rc = Rc::new(
                        self.texture_loader
                            .load_texture(&info, data, cmd.unwrap())
                            .unwrap(),
                    );
                    let asset = TextureAsset2::Loaded(rc.clone());
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
        if material.ao_texture == TextureHandle::null() {
            material.ao_texture = self.default_material.ao_texture;
        }
        let asset = Asset(Rc::new(material));
        self.materials.insert(handle, asset);
        handle
    }

    pub fn get_material(&self, handle: MaterialHandle) -> Option<Rc<Material>> {
        self.materials.get(&handle).map(|asset| Rc::clone(&asset.0))
    }

    pub fn add_mesh(&mut self, info: MeshInfo) -> MeshHandle {
        let handle = MeshHandle::new();
        self.meshes.insert(handle, info);
        handle
    }

    pub fn get_mesh(&mut self, handle: MeshHandle) -> Option<&MeshInfo> { self.meshes.get(&handle) }

    pub fn map_textures(
        &mut self,
        cmd: &CommandBuffer,
    ) -> Result<(Vec<Rc<Texture>>, HashMap<TextureHandle, usize>)> {
        let mut textures = Vec::new();
        let mut handle_map = HashMap::new();
        let handles = self.textures.keys().cloned().collect::<Vec<_>>();

        for handle in handles.iter() {
            let texture = self
                .get_or_load_texture(&handle.clone(), Some(cmd))
                .unwrap_or_else(|| panic!("Cached texture not found: {:?}", handle));
            let index = textures.len();
            log::debug!(
                "Mapped texture {:?} ({:?}) to array index {}",
                handle,
                texture.name(),
                index
            );

            textures.push(texture);
            handle_map.insert(handle.clone(), index);
        }

        Ok((textures, handle_map))
    }

    pub fn map_meshes(
        &mut self,
        cmd: &CommandBuffer,
    ) -> Result<(Vec<MeshInfo>, HashMap<MeshHandle, usize>)> {
        let mut meshes = Vec::new();
        let mut handle_map = HashMap::new();
        let handles = { self.meshes.keys().cloned().collect::<Vec<_>>() };

        for handle in handles {
            let mesh = self
                .get_mesh(handle.clone())
                .unwrap_or_else(|| panic!("Cached mesh not found: {:?}", handle));
            meshes.push(mesh.clone());
            handle_map.insert(handle.clone(), meshes.len() - 1);
        }

        Ok((meshes, handle_map))
    }

    pub fn map_materials(
        &self,
        texture_map: &HashMap<TextureHandle, usize>,
    ) -> Result<(Vec<GpuMaterialData>, HashMap<MaterialHandle, usize>)> {
        let handles = {
            let handles = self.materials.keys().cloned().collect::<Vec<_>>();
            handles
        };

        let mut handle_map = HashMap::new();
        let mut materials = Vec::new();

        for handle in handles {
            let material = self.get_material(handle).unwrap_or_else(|| {
                panic!("Material not found: {:?}", handle);
            });

            let color_texture = texture_map.get(&material.color_texture).unwrap_or(&0);
            let normal_texture = texture_map.get(&material.normal_texture).unwrap_or(&0);
            let metalrough_texture = texture_map.get(&material.metalrough_texture).unwrap_or(&0);
            let ao_texture = texture_map.get(&material.ao_texture).unwrap_or(&0);
            let gpu_material = GpuMaterialData {
                color_factor: material.color_factor,
                metallic_factor: material.metallic_factor,
                roughness_factor: material.roughness_factor,
                ao_strength: material.ao_strength,
                color_texture_index: *color_texture as u32,
                normal_texture_index: *normal_texture as u32,
                metalrough_texture_index: *metalrough_texture as u32,
                ao_texture_index: *ao_texture as u32,
                padding0: 0.,
            };

            materials.push(gpu_material);
            let index = materials.len() - 1;

            handle_map.insert(handle, index);
            log::debug!("Mapped material {handle:?} to array index {index} ({gpu_material:?})");
        }

        for (key, value) in handle_map.iter() {
            log::trace!("Material: {:?} -> {:?}", key, value);
        }

        Ok((materials, handle_map))
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
        self.gpu
            .device()
            .flush_mapped_memory_ranges(&[memory_range]);

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

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuMaterialData {
    pub color_factor: Vec4,
    pub color_texture_index: u32,
    pub normal_texture_index: u32,
    pub metallic_factor: f32,
    pub roughness_factor: f32,
    pub metalrough_texture_index: u32,
    pub ao_strength: f32,
    pub ao_texture_index: u32,
    pub padding0: f32,
}

#[cfg(test)]
mod tests {
    use crate::test::test_gpu;

    #[test]
    fn test_assets() { let _ = test_gpu(); }
}
