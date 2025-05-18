use {
    crate::{model::MeshInfo, Material, Mesh, Primitive, Vertex},
    aleph_vk::{
        uploader::Poolable, Buffer, Extent2D, Filter, Format, Gpu, ImageAspectFlags,
        ImageUsageFlags, PrimitiveTopology, ResourcePool, Sampler, SamplerAddressMode,
        SamplerMipmapMode, Texture, TextureInfo, TypedBuffer,
    },
    anyhow::Result,
    glam::vec4,
    image::{ImageBuffer, Rgba},
    std::{
        cell::{RefCell, RefMut},
        collections::HashMap,
        hash::Hash,
        sync::{
            atomic::{AtomicU64, Ordering},
            Arc,
        },
    },
};

const WHITE: [u8; 4] = [255, 255, 255, 255];
const NORMAL: [u8; 4] = [127, 127, 255, 255];

static ASSET_HANDLE_INDEX: AtomicU64 = AtomicU64::new(1);

pub struct AssetHandle<T> {
    index: u64,
    marker: std::marker::PhantomData<T>,
}

impl<T> AssetHandle<T> {
    pub fn new() -> Self {
        let index = ASSET_HANDLE_INDEX.fetch_add(1, Ordering::Relaxed);
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

impl<T> std::fmt::Display for AssetHandle<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "MeshHandle({})", self.index)
    }
}

impl<T> Clone for AssetHandle<T> {
    fn clone(&self) -> Self { *self }
}

impl<T> PartialEq for AssetHandle<T> {
    fn eq(&self, other: &Self) -> bool { self.index == other.index }
}
impl<T> Hash for AssetHandle<T> {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) { self.index.hash(state); }
}

impl<T> Copy for AssetHandle<T> {}
impl<T> Eq for AssetHandle<T> {}

pub type MeshHandle = AssetHandle<Mesh>;
impl std::fmt::Debug for MeshHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "MeshHandle({})", self.index)
    }
}

pub type TextureHandle = AssetHandle<Texture>;
impl std::fmt::Debug for TextureHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "TextureHandle({})", self.index)
    }
}

pub type MaterialHandle = AssetHandle<Material>;
impl std::fmt::Debug for MaterialHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "MaterialHandle({})", self.index)
    }
}

enum Asset<T, D> {
    Loaded(T),
    Unloaded(D),
}

type TextureAsset = Asset<Texture, TextureInfo>;

type AssetCache<T, D> = RefCell<HashMap<AssetHandle<T>, Asset<T, D>>>;

pub struct Assets {
    gpu: Arc<Gpu>,
    meshes: HashMap<MeshHandle, Mesh>,
    textures: AssetCache<Texture, TextureInfo>,
    materials: HashMap<MaterialHandle, Material>,
    // uploader: RefCell<Uploader>,
    default_material: MaterialHandle,
    default_sampler: Sampler,
    staging_pool: ResourcePool<Buffer>,
}

impl Assets {
    const UPLOAD_POOL_SIZE: usize = 10;
    const UPLOAD_RETAINED_SIZE: u64 = 1024 * 1024 * 10;
    const UPLOAD_RETAINED_FRAMES: usize = 5;
    const DEFAULT_EXTENT: Extent2D = Extent2D {
        width: 8,
        height: 8,
    };

    pub fn new(gpu: Arc<Gpu>) -> Result<Self> {
        let textures = RefCell::new(HashMap::new());
        let materials = HashMap::new();
        let meshes = HashMap::new();
        // let uploader = RefCell::new(Uploader::new(
        //     &gpu,
        //     Self::UPLOAD_POOL_SIZE,
        //     Self::UPLOAD_RETAINED_FRAMES,
        //     Self::UPLOAD_RETAINED_SIZE,
        // )?);

        let default_sampler = gpu.create_sampler(
            Filter::LINEAR,
            Filter::LINEAR,
            SamplerMipmapMode::LINEAR,
            SamplerAddressMode::REPEAT,
            SamplerAddressMode::REPEAT,
        )?;
        let pool =
            ResourcePool::<Buffer>::new(&gpu, Self::UPLOAD_POOL_SIZE, Self::UPLOAD_RETAINED_FRAMES);

        let mut assets = Self {
            gpu,
            meshes,
            textures,
            materials,
            // uploader,
            default_material: MaterialHandle::null(),
            default_sampler,
            staging_pool: pool,
        };
        assets.default_material = assets.add_default_material()?;

        Ok(assets)
    }

    pub fn update(&mut self) { self.staging_pool.update(); }

    pub fn default_sampler(&self) -> Sampler { self.default_sampler }

    pub fn default_material(&self) -> Material {
        self.material(self.default_material).unwrap().clone()
    }

    fn add_default_material(&mut self) -> Result<MaterialHandle> {
        let sampler = self.gpu.create_sampler(
            Filter::LINEAR,
            Filter::LINEAR,
            SamplerMipmapMode::LINEAR,
            SamplerAddressMode::REPEAT,
            SamplerAddressMode::REPEAT,
        )?;
        let white_srgb =
            self.add_default_texture(&WHITE, Format::R8G8B8A8_SRGB, "white-srgb", sampler);
        let white_linear =
            self.add_default_texture(&WHITE, Format::R8G8B8A8_UNORM, "white-unorm", sampler);
        let normal = self.add_default_texture(&NORMAL, Format::R8G8B8A8_UNORM, "normal", sampler);

        let material = Material {
            name: "default".to_string(),
            color_texture: white_srgb,
            color_factor: vec4(1., 1., 1., 1.),
            normal_texture: normal,
            metalrough_texture: white_linear,
            metallic_factor: 1.0,
            roughness_factor: 1.0,
            ao_texture: white_linear,
            ao_strength: 1.0,
        };

        self.add_material(material)
    }

    fn add_default_texture(
        &mut self,
        color: &[u8; 4],
        format: Format,
        name: &str,
        sampler: Sampler,
    ) -> TextureHandle {
        let pixel = Rgba::<u8>(*color);
        let buffer = ImageBuffer::from_pixel(16, 16, pixel);
        let data = buffer.to_vec();
        let info = TextureInfo {
            name: name.to_string(),
            data,
            extent: Self::DEFAULT_EXTENT,
            flags: ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
            aspect_flags: ImageAspectFlags::COLOR,
            format,
            sampler: Some(sampler),
        };

        self.add_texture(info)
    }

    pub fn add_texture(&mut self, desc: TextureInfo) -> TextureHandle {
        let handle = TextureHandle::new();
        let asset = TextureAsset::Unloaded(desc);
        self.textures.borrow_mut().insert(handle, asset);
        handle
    }

    pub fn texture(&self, handle: TextureHandle) -> Option<Texture> {
        let mut textures = self.textures.borrow_mut();
        match textures.get(&handle) {
            Some(TextureAsset::Loaded(texture)) => Some(texture.clone()),
            Some(TextureAsset::Unloaded(desc)) => {
                let texture = self.load_texture(&desc).unwrap();
                textures.insert(handle, TextureAsset::Loaded(texture.clone()));
                Some(texture)
            }
            None => None,
        }
    }

    pub fn textures(&self) -> Vec<(TextureHandle, Texture)> {
        let keys = self.textures.borrow().keys().cloned().collect::<Vec<_>>();
        keys.into_iter()
            .filter_map(|k| match self.texture(k) {
                Some(texture) => Some((k, texture)),
                None => None,
            })
            .collect()
    }

    // fn load_texture(&self, info: &TextureInfo) -> Result<Texture> {
    //     let texture = Texture::new(&self.gpu, info)?;
    //     let mut uploader = self.uploader.borrow_mut();
    //     uploader.enqueue_image(&*texture, &info.data);

    //     Ok(texture)
    // }

    fn load_texture(&self, desc: &TextureInfo) -> Result<Texture> {
        let texture = Texture::new(&self.gpu, desc)?;
        self.gpu.execute(|cmd| {
            let staging = self.staging_pool.next();
            let data = bytemuck::cast_slice(&desc.data);
            staging.write(data);

            cmd.copy_buffer_to_image(&staging, &*texture)
        })?;

        Ok(texture)
    }

    pub fn add_material(&mut self, material: Material) -> Result<MaterialHandle> {
        let handle = MaterialHandle::new();
        self.materials.insert(handle, material);
        Ok(handle)
    }

    pub fn material(&self, handle: MaterialHandle) -> Option<&Material> {
        self.materials.get(&handle)
    }

    pub fn materials(&self) -> Vec<(MaterialHandle, &Material)> {
        self.materials
            .keys()
            .into_iter()
            .filter_map(|k| match self.material(*k) {
                Some(texture) => Some((*k, texture)),
                None => None,
            })
            .collect()
    }

    pub fn add_mesh(&mut self, desc: MeshInfo) -> Result<MeshHandle> {
        let mut primitives = vec![];
        for primitive_desc in &desc.primitives {
            let indices = &primitive_desc.indices;
            let vertices = &primitive_desc.vertices;

            let index_buffer = TypedBuffer::<u32>::index(&self.gpu, indices.len(), "index")?;
            let index_staging = self.staging_pool.next();
            index_staging.write(bytemuck::cast_slice(indices));

            let vertex_buffer = TypedBuffer::<Vertex>::vertex(&self.gpu, vertices.len(), "vertex")?;
            let vertex_staging = self.staging_pool.next();
            vertex_staging.write(bytemuck::cast_slice(vertices));
            let n_vertices = vertices.len();

            self.gpu.execute(|cmd| {
                cmd.copy_buffer(&vertex_staging, &vertex_buffer, vertex_buffer.size());
                cmd.copy_buffer(&index_staging, &index_buffer, index_buffer.size());
            })?;

            primitives.push(Primitive {
                vertex_buffer,
                index_buffer,
                material: primitive_desc.material,
                vertex_count: n_vertices as u32,
                topology: PrimitiveTopology::TRIANGLE_LIST,
            });
        }

        let mesh = Mesh {
            name: desc.name.clone(),
            primitives,
        };
        let handle = MeshHandle::new();
        self.meshes.insert(handle, mesh);
        Ok(handle)
    }

    pub fn mesh(&self, handle: MeshHandle) -> Option<&Mesh> { self.meshes.get(&handle) }

    pub fn meshes(&self) -> Vec<(MeshHandle, &Mesh)> {
        self.meshes
            .keys()
            .into_iter()
            .filter_map(|k| match self.mesh(*k) {
                Some(texture) => Some((*k, texture)),
                None => None,
            })
            .collect()
    }
}
