use {
    crate::{
        model::{MeshInfo, Vertex},
        Material, Mesh,
    },
    aleph_vk::{
        Buffer, CommandBuffer, Extent2D, Filter, Format, Gpu, ImageAspectFlags, ImageUsageFlags,
        PrimitiveTopology, ResourcePool, Sampler, SamplerAddressMode, SamplerMipmapMode, Texture,
        TextureInfo, TypedBuffer,
    },
    anyhow::Result,
    bytemuck::{Pod, Zeroable},
    derive_more::Debug,
    glam::{vec4, Vec2, Vec3, Vec4},
    image::{ImageBuffer, Rgba},
    std::{
        cell::RefCell,
        collections::HashMap,
        hash::{Hash, Hasher},
        rc::Rc,
        sync::{
            atomic::{AtomicU64, Ordering},
            Arc,
        },
    },
};

static ASSET_HANDLE_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug)]
pub struct AssetHandle<T> {
    index: u64,
    #[debug(skip)]
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

pub type MeshHandle = AssetHandle<Mesh>;
pub type TextureHandle = AssetHandle<Texture>;
pub type MaterialHandle = AssetHandle<Material>;

#[derive(Debug, Default)]
struct Asset<T>(Rc<T>);

#[derive(Debug)]
enum LazyAsset<T, D> {
    Loaded(Rc<T>),
    Unloaded(D),
}

type TextureAsset = LazyAsset<Texture, TextureInfo>;
type MeshAsset = LazyAsset<Mesh, MeshInfo>;
type LazyCache<T, D> = RefCell<HashMap<AssetHandle<T>, LazyAsset<T, D>>>;
type AssetCache<T> = RefCell<HashMap<AssetHandle<T>, Asset<T>>>;

#[derive(Debug)]
pub struct Assets {
    gpu: Arc<Gpu>,
    meshes: LazyCache<Mesh, MeshInfo>,
    textures: LazyCache<Texture, TextureInfo>,
    materials: AssetCache<Material>,
    default_material: MaterialHandle,
    default_sampler: Sampler,
    staging_pool: ResourcePool<Buffer>,
}

impl Assets {
    const WHITE: [u8; 4] = [255, 255, 255, 255];
    const NORMAL: [u8; 4] = [127, 127, 255, 255];
    const STAGING_POOL_SIZE: usize = 10;
    const STAGING_POOL_RETENTION: usize = 5;
    const DEFAULT_EXTENT: Extent2D = Extent2D {
        width: 8,
        height: 8,
    };

    pub fn new(gpu: Arc<Gpu>) -> Result<Self> {
        let default_sampler = gpu.create_sampler(
            Filter::LINEAR,
            Filter::LINEAR,
            SamplerMipmapMode::LINEAR,
            SamplerAddressMode::REPEAT,
            SamplerAddressMode::REPEAT,
        )?;
        let staging_pool = ResourcePool::<Buffer>::new(
            &gpu,
            Self::STAGING_POOL_SIZE,
            Self::STAGING_POOL_RETENTION,
        );

        let mut assets = Self {
            gpu,
            meshes: RefCell::new(HashMap::new()),
            textures: RefCell::new(HashMap::new()),
            materials: RefCell::new(HashMap::new()),
            default_material: MaterialHandle::null(),
            default_sampler,
            staging_pool,
        };
        assets.default_material = assets.create_default_material()?;

        Ok(assets)
    }

    pub fn update(&mut self) { self.staging_pool.update(); }

    pub fn default_sampler(&self) -> Sampler { self.default_sampler }

    pub fn default_material(&self) -> Rc<Material> {
        self.get_material(self.default_material.clone())
            .unwrap()
            .clone()
    }

    fn create_default_texture(&self, color: &[u8; 4], format: Format, name: &str) -> TextureInfo {
        let pixel = Rgba::<u8>(*color);
        let buffer = ImageBuffer::from_pixel(16, 16, pixel);
        let data = buffer.to_vec();
        TextureInfo {
            name: name.to_string(),
            data,
            extent: Self::DEFAULT_EXTENT,
            flags: ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
            aspect_flags: ImageAspectFlags::COLOR,
            format,
            sampler: Some(self.default_sampler.clone()),
        }
    }

    fn create_default_material(&mut self) -> Result<MaterialHandle> {
        let format = Format::R8G8B8A8_SRGB;
        let white_srgb = self.create_default_texture(&Self::WHITE, format, "default-white-srgb");
        let white = self.create_default_texture(&Self::WHITE, format, "default-white-unorm");
        let normal = self.create_default_texture(&Self::NORMAL, format, "default-normal");

        let color_texture = self.add_texture(white_srgb);
        let normal_texture = self.add_texture(normal);
        let metalrough_texture = self.add_texture(white.clone());
        let ao_texture = self.add_texture(white);

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

        Ok(self.add_material(material))
    }

    pub fn add_texture(&mut self, info: TextureInfo) -> TextureHandle {
        let handle = TextureHandle::new();
        let asset = TextureAsset::Unloaded(info);
        self.textures.borrow_mut().insert(handle, asset);
        handle
    }

    pub fn get_texture(&self, handle: TextureHandle) -> Option<Rc<Texture>> {
        self.get_or_load_texture(&handle, None)
    }

    fn get_or_load_texture(
        &self,
        handle: &TextureHandle,
        cmd: Option<&CommandBuffer>,
    ) -> Option<Rc<Texture>> {
        let mut textures = self.textures.borrow_mut();
        match textures.get(&handle) {
            Some(asset) => match asset {
                TextureAsset::Loaded(texture) => Some(Rc::clone(texture)),
                TextureAsset::Unloaded(info) => {
                    let rc = Rc::new(self.load_texture(&info, cmd).unwrap());
                    let asset = TextureAsset::Loaded(rc.clone());
                    (*textures).insert(*handle, asset);
                    Some(rc)
                }
            },
            None => None,
        }
    }

    fn load_texture(&self, info: &TextureInfo, cmd: Option<&CommandBuffer>) -> Result<Texture> {
        let texture = Texture::new(&self.gpu, info)?;
        let data = bytemuck::cast_slice(&info.data);
        let staging = self.staging_pool.next();
        staging.write(data);

        let memory_range = staging.mapped_memory_range();
        self.gpu
            .device()
            .flush_mapped_memory_ranges(&[memory_range]);

        match cmd {
            Some(cmd) => cmd.copy_buffer_to_image(&staging, &texture),
            None => self
                .gpu
                .execute(|cmd| cmd.copy_buffer_to_image(&staging, &texture)),
        }

        Ok(texture)
    }

    pub fn map_textures(
        &self,
        cmd: &CommandBuffer,
    ) -> Result<(Vec<Rc<Texture>>, HashMap<TextureHandle, usize>)> {
        let mut textures = Vec::new();
        let mut handle_map = HashMap::new();
        let handles = {
            let cached = self.textures.borrow();
            let mut handles = cached.keys().cloned().collect::<Vec<_>>();
            handles.insert(0, self.default_material().color_texture);
            handles
        };

        for handle in handles.iter() {
            let texture = self
                .get_or_load_texture(&handle.clone(), Some(cmd))
                .unwrap_or_else(|| panic!("Cached texture not found: {:?}", handle));
            textures.push(texture);
            handle_map.insert(handle.clone(), textures.len() - 1);
        }

        Ok((textures, handle_map))
    }

    pub fn add_material(&self, material: Material) -> MaterialHandle {
        let handle = MaterialHandle::new();
        let asset = Asset(Rc::new(material));
        self.materials.borrow_mut().insert(handle, asset);
        handle
    }

    pub fn get_material(&self, handle: MaterialHandle) -> Option<Rc<Material>> {
        self.materials
            .borrow()
            .get(&handle)
            .map(|asset| Rc::clone(&asset.0))
    }

    pub fn map_materials(
        &self,
        texture_map: &HashMap<TextureHandle, usize>,
    ) -> Result<(Vec<GpuMaterialData>, HashMap<MaterialHandle, usize>)> {
        let handles = {
            let cache = self.materials.borrow_mut();
            let mut handles = cache.keys().cloned().collect::<Vec<_>>();
            handles.insert(0, self.default_material.clone());
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
                color_texture_index: *color_texture as i32,
                normal_texture_index: *normal_texture as i32,
                metalrough_texture_index: *metalrough_texture as i32,
                ao_texture_index: *ao_texture as i32,
                padding0: 0.,
            };

            materials.push(gpu_material);
            handle_map.insert(handle, materials.len() - 1);
        }

        for (key, value) in handle_map.iter() {
            log::trace!("Material: {:?} -> {:?}", key, value);
        }

        Ok((materials, handle_map))
    }

    pub fn add_mesh(&mut self, info: MeshInfo) -> MeshHandle {
        let handle = MeshHandle::new();
        let asset = MeshAsset::Unloaded(info);
        self.meshes.borrow_mut().insert(handle, asset);
        handle
    }

    pub fn get_mesh(&self, handle: MeshHandle) -> Option<Rc<Mesh>> {
        self.get_or_load_mesh(&handle, None)
    }

    fn get_or_load_mesh(
        &self,
        handle: &MeshHandle,
        cmd: Option<&CommandBuffer>,
    ) -> Option<Rc<Mesh>> {
        let mut meshes = self.meshes.borrow_mut();
        match meshes.get(handle) {
            Some(MeshAsset::Loaded(mesh)) => Some(Rc::clone(mesh)),
            Some(MeshAsset::Unloaded(info)) => {
                let rc = Rc::new(self.load_mesh(&info, cmd).unwrap());
                let asset = MeshAsset::Loaded(rc.clone());
                meshes.insert(*handle, asset);
                Some(rc)
            }
            None => None,
        }
    }

    fn load_mesh(&self, info: &MeshInfo, cmd: Option<&CommandBuffer>) -> Result<Mesh> {
        let mut index_buffer = TypedBuffer::index(&self.gpu, info.indices.len(), "index")?;
        let mut vertex_buffer = TypedBuffer::vertex(&self.gpu, info.vertices.len(), "vertex")?;
        let vertex_count = info.vertices.len();
        let vertices = (0..vertex_count)
            .map(|i| Vertex {
                position: info.vertices[i],
                normal: *info.normals.get(i).unwrap_or(&Vec3::ONE),
                tangent: *info.tangents.get(i).unwrap_or(&Vec4::ONE),
                color: *info.colors.get(i).unwrap_or(&Vec4::ONE),
                uv_x: info.tex_coords0.get(i).unwrap_or(&Vec2::ZERO)[0],
                uv_y: info.tex_coords0.get(i).unwrap_or(&Vec2::ZERO)[1],
            })
            .collect::<Vec<_>>();

        let index_data = bytemuck::cast_slice(&info.indices);
        index_buffer.write(index_data);

        let vertex_data = bytemuck::cast_slice(&vertices);
        vertex_buffer.write(vertex_data);

        let mesh = Mesh {
            vertex_buffer,
            vertex_count: vertex_count as u32,
            index_buffer,
            material: info.material,
            topology: PrimitiveTopology::TRIANGLE_LIST,
            name: info.name.clone(),
        };
        Ok(mesh)
    }

    pub fn map_meshes(
        &self,
        cmd: &CommandBuffer,
    ) -> Result<(Vec<Rc<Mesh>>, HashMap<MeshHandle, usize>)> {
        let mut meshes = Vec::new();
        let mut handle_map = HashMap::new();
        let handles = {
            let cached = self.meshes.borrow();
            cached.keys().cloned().collect::<Vec<_>>()
        };

        for handle in handles {
            let mesh = self
                .get_or_load_mesh(&handle.clone(), Some(cmd))
                .unwrap_or_else(|| panic!("Cached mesh not found: {:?}", handle));
            meshes.push(mesh);
            handle_map.insert(handle.clone(), meshes.len() - 1);
        }

        Ok((meshes, handle_map))
    }
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuMaterialData {
    pub color_factor: Vec4,
    pub color_texture_index: i32,
    pub normal_texture_index: i32,
    pub metallic_factor: f32,
    pub roughness_factor: f32,
    pub metalrough_texture_index: i32,
    pub ao_strength: f32,
    pub ao_texture_index: i32,
    pub padding0: f32,
}

#[cfg(test)]
mod tests {
    use crate::test::test_gpu;

    #[test]
    fn test_assets() { let _ = test_gpu(); }
}
