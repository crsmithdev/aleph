// --- Imports ---
use {
    crate::{Material, MeshInfo},
    aleph_vk::{
        sync, AccessFlags2, Buffer, BufferImageCopy, BufferUsageFlags, CommandBuffer, Extent2D,
        Filter, Format, Gpu, ImageAspectFlags, ImageLayout, ImageSubresourceLayers,
        ImageUsageFlags, Offset3D, PipelineStageFlags2, Sampler, SamplerAddressMode,
        SamplerMipmapMode, Texture, TextureInfo,
    },
    anyhow::{bail, Result},
    bytemuck::{Pod, Zeroable},
    derive_more::Debug,
    glam::{vec4, Vec4},
    gpu_allocator::MemoryLocation,
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

// --- Constants and Statics ---
const WHITE: [u8; 4] = [255, 255, 255, 255];
const NORMAL: [u8; 4] = [127, 127, 255, 255];
static ASSET_HANDLE_COUNTER: AtomicU64 = AtomicU64::new(1);
const DEFAULT_EXTENT: Extent2D = Extent2D {
    width: 8,
    height: 8,
};

// --- Asset Handle Types ---
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

impl<T> std::fmt::Debug for AssetHandle<T> {
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

// --- Asset State Types ---
#[derive(Debug)]
enum AsyncAsset<T, I, D> {
    Loaded(Rc<T>),
    Unloaded(I, D),
}
type TextureAsset = AsyncAsset<Texture, TextureInfo, Vec<u8>>;
type AsyncCache<T, I, D> = HashMap<AssetHandle<T>, AsyncAsset<T, I, D>>;

// --- GPU-Facing Structs ---
#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuMaterial {
    pub color_index: u32,
    pub normal_index: u32,
    pub metalrough_index: u32,
    pub occlusion_index: u32,
    pub color_factor: Vec4,
    pub metal_factor: f32,
    pub rough_factor: f32,
    pub occlusion_strength: f32,
    pub _padding0: u32,
}

pub struct BindlessData {
    pub textures: Vec<Rc<Texture>>,
    pub texture_map: HashMap<TextureHandle, usize>,
    pub meshes: Vec<MeshInfo>,
    pub mesh_map: HashMap<MeshHandle, usize>,
    pub materials: Vec<GpuMaterial>,
    pub material_map: HashMap<MaterialHandle, usize>,
}

// --- TextureLoader ---
#[derive(Debug)]
struct TextureLoader {
    gpu: Arc<Gpu>,
    staging: Buffer,
}

impl TextureLoader {
    fn new(gpu: Arc<Gpu>) -> Self {
        let staging = Buffer::new(
            &gpu.device(),
            &gpu.allocator(),
            32 * 1024 * 1024,
            BufferUsageFlags::TRANSFER_SRC,
            MemoryLocation::CpuToGpu,
            "texture_staging",
        )
        .unwrap_or_else(|e| panic!("Failed to create staging buffer: {e}"));
        Self { gpu, staging }
    }
    fn update(&mut self) {}
    fn load_texture(
        &self,
        info: &TextureInfo,
        data: &[u8],
        cmd: &CommandBuffer,
    ) -> Result<Texture> {
        let texture = Texture::new(&self.gpu, info)?;
        let data: &[u8] = bytemuck::cast_slice(data);
        let size = data.len() as u64;
        let alignment = 256;
        let sub = self
            .staging
            .sub_buffer(size, alignment)
            .unwrap_or_else(|| panic!("Failed to sub-allocate staging buffer (size={size})"));
        sub.write(data);
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
        let buffer_offset = sub.offset();
        let copy = BufferImageCopy::default()
            .buffer_offset(buffer_offset)
            .buffer_row_length(0)
            .buffer_image_height(0)
            .image_subresource(
                ImageSubresourceLayers::default()
                    .aspect_mask(ImageAspectFlags::COLOR)
                    .layer_count(1),
            )
            .image_offset(Offset3D::default())
            .image_extent(texture.extent().into());
        cmd.copy_buffer_to_image_region(&self.staging, &texture, &copy);
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

// --- Assets System ---
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
                color_index: texture_index(material.color_texture),
                normal_index: texture_index(material.normal_texture),
                metalrough_index: texture_index(material.metalrough_texture),
                occlusion_index: texture_index(material.occlusion_texture),
                color_factor: material.color_factor,
                metal_factor: material.metallic_factor,
                rough_factor: material.roughness_factor,
                occlusion_strength: material.ao_strength,
                _padding0: 0,
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

// --- Tests ---
#[cfg(test)]
mod tests {
    use {
        super::*,
        std::{collections::HashSet, rc::Rc},
    };
    #[test]
    fn asset_handle_equality_and_hashing() {
        let a: AssetHandle<u32> = AssetHandle::new();
        let b: AssetHandle<u32> = AssetHandle::new();
        let c = a;
        assert_eq!(a, c);
        assert_ne!(a, b);
        let mut set = HashSet::new();
        set.insert(a);
        assert!(set.contains(&a));
        assert!(!set.contains(&b));
    }
    #[test]
    fn asset_handle_default_and_null() {
        let null: AssetHandle<u32> = AssetHandle::null();
        let default: AssetHandle<u32> = AssetHandle::default();
        assert_eq!(null, default);
        assert_eq!(null.index, 0);
    }
    #[test]
    fn async_asset_state_transitions() {
        let loaded: AsyncAsset<u32, (), ()> = AsyncAsset::Loaded(Rc::new(42));
        let unloaded: AsyncAsset<u32, (), ()> = AsyncAsset::Unloaded((), ());
        match loaded {
            AsyncAsset::Loaded(val) => assert_eq!(*val, 42),
            _ => panic!("Expected Loaded"),
        }
        match unloaded {
            AsyncAsset::Unloaded(_, _) => (),
            _ => panic!("Expected Unloaded"),
        }
    }
    #[test]
    fn assets_add_and_get_mesh_material_texture() {
        use {
            crate::{assets::Assets, Material, MeshInfo},
            aleph_vk::{Extent2D, Format, Gpu, ImageAspectFlags, ImageUsageFlags, TextureInfo},
            std::sync::Arc,
        };
        let gpu = Arc::new(Gpu::headless().unwrap());
        let mut assets = Assets::new(gpu).unwrap();
        let mesh = MeshInfo::default();
        let mesh_handle = assets.add_mesh(mesh.clone());
        assert_eq!(assets.get_mesh(mesh_handle), Some(&mesh));
        let mat = Material::default();
        let mat_handle = assets.add_material(mat.clone());
        assert!(assets.get_material(mat_handle).is_some());
        let tex_info = TextureInfo {
            name: "test".to_string(),
            extent: Extent2D {
                width: 1,
                height: 1,
            },
            flags: ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
            aspect_flags: ImageAspectFlags::COLOR,
            format: Format::R8G8B8A8_UNORM,
            sampler: None,
        };
        let tex_data = vec![255u8, 0, 0, 255];
        let tex_handle = assets.add_texture(tex_info, &tex_data);
        assert!(assets.textures.contains_key(&tex_handle));
    }
    #[test]
    fn texture_loader_staging_suballocation() {
        use {
            aleph_vk::{Extent2D, Format, Gpu, ImageAspectFlags, ImageUsageFlags, TextureInfo},
            std::sync::Arc,
        };
        let gpu = Arc::new(Gpu::headless().unwrap());
        let loader = TextureLoader::new(gpu.clone());
        let info = TextureInfo {
            name: "test".to_string(),
            extent: Extent2D {
                width: 1,
                height: 1,
            },
            flags: ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
            aspect_flags: ImageAspectFlags::COLOR,
            format: Format::R8G8B8A8_UNORM,
            sampler: None,
        };
        let data = vec![255u8, 0, 0, 255];
        let sub = loader.staging.sub_buffer(4, 256).expect("suballoc");
        sub.write(&data);
        assert_eq!(sub.size(), 4);
    }
}
// Why do Rust programmers never get lost? Because they always keep track of their handles!
