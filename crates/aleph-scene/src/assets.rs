use {
    crate::{model::MeshInfo, util, Material, Mesh, Primitive, Vertex},
    aleph_vk::{
        texture::TextureInfo2, uploader, Extent2D, Filter, Format, Gpu, ImageAspectFlags,
        ImageUsageFlags, MemoryLocation, PrimitiveTopology, Sampler, SamplerAddressMode,
        SamplerMipmapMode, Texture, TextureInfo, TypedBuffer, Uploader,
    },
    anyhow::Result,
    image::{ImageBuffer, Rgba},
    std::{
        cell::RefCell,
        collections::HashMap,
        default,
        hash::Hash,
        rc::Rc,
        sync::{
            atomic::{AtomicU64, Ordering},
            Arc,
        },
    },
};

const WHITE: [u8; 4] = [255, 255, 255, 255];
const NORMAL: [u8; 4] = [127, 127, 255, 255];

static ASSET_HANDLE_INDEX: AtomicU64 = AtomicU64::new(0);

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

pub struct Defaults {
    pub white_srgb: Rc<Texture>,
    pub white_linear: Rc<Texture>,
    pub normal: Rc<Texture>,
    red: Rc<Texture>,
    pub sampler: Sampler,
}

impl Defaults {}

enum Asset<T, D> {
    Loaded(Rc<T>),
    Unloaded(D),
}

type TextureAsset = Asset<Texture, TextureInfo>;

type AssetCache<T, D> = RefCell<HashMap<AssetHandle<T>, Asset<T, D>>>;

pub struct Assets {
    gpu: Arc<Gpu>,
    meshes: HashMap<MeshHandle, Mesh>,
    textures: AssetCache<Texture, TextureInfo>,
    materials: HashMap<MaterialHandle, Material>,
    pub uploader: RefCell<uploader::Uploader>,
    pub default_texture: Texture,
    pub defaults: Defaults,
}

impl Assets {
    const DEFAULT_EXTENT: Extent2D = Extent2D {
        width: 8,
        height: 8,
    };

    pub fn new(gpu: Arc<Gpu>) -> Result<Self> {
        let textures = RefCell::new(HashMap::new());
        let materials = HashMap::new();
        let meshes = HashMap::new();
        let defaults = Self::load_defaults(&gpu)?;
        let default_texture = Texture::new2(
            &gpu,
            &TextureInfo2 {
                name: "default".to_string(),
                extent: Self::DEFAULT_EXTENT,
                format: Format::R8G8B8A8_SRGB,
                flags: ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
                aspect_flags: ImageAspectFlags::COLOR,
                sampler: Some(defaults.sampler),
            },
        )?;
        let uploader = RefCell::new(Uploader::new(&gpu, 10, 2, 1024 * 1024 * 10)?);

        let mut assets = Self {
            gpu,
            meshes,
            textures,
            uploader,
            materials,
            defaults,
            default_texture,
        };

        assets.add_texture_loaded(assets.defaults.white_srgb.clone());
        assets.add_texture_loaded(assets.defaults.white_linear.clone());
        assets.add_texture_loaded(assets.defaults.normal.clone());
        assets.add_texture_loaded(assets.defaults.red.clone());

        Ok(assets)
    }

    pub fn create_default(
        gpu: &Gpu,
        color: &[u8; 4],
        format: Format,
        name: impl Into<String>,
        sampler: Sampler,
    ) -> Result<Texture> {
        let pixel = Rgba::<u8>(*color);
        let buffer = ImageBuffer::from_pixel(16, 16, pixel);
        let data = buffer.as_raw();

        Ok(Self::load_texture(
            gpu,
            &TextureInfo {
                name: name.into(),
                data: data.to_vec(),
                extent: Self::DEFAULT_EXTENT,
                flags: ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
                aspect_flags: ImageAspectFlags::COLOR,
                format,
                sampler: Some(sampler),
            },
        )?)
    }

    fn load_defaults(gpu: &Gpu) -> Result<Defaults> {
        let srgb = Format::R8G8B8A8_SRGB;
        let linear = Format::R8G8B8A8_UNORM;
        let sampler = gpu.create_sampler(
            Filter::LINEAR,
            Filter::LINEAR,
            SamplerMipmapMode::LINEAR,
            SamplerAddressMode::REPEAT,
            SamplerAddressMode::REPEAT,
        )?;

        let white_srgb = Self::create_default(gpu, &WHITE, srgb, "white-srgb", sampler)?;
        let white_linear = Self::create_default(gpu, &WHITE, linear, "white-linear", sampler)?;
        let normal = Self::create_default(gpu, &NORMAL, linear, "normal", sampler)?;
        let red = Self::create_default(gpu, &[255, 0, 0, 255], linear, "red", sampler)?;

        Ok(Defaults {
            white_srgb: Rc::new(white_srgb),
            white_linear: Rc::new(white_linear),
            normal: Rc::new(normal),
            red: Rc::new(red),
            sampler,
        })
    }

    pub fn add_texture_loaded(&mut self, texture: Rc<Texture>) -> TextureHandle {
        let handle = TextureHandle::new();
        let asset = TextureAsset::Loaded(texture.clone());
        self.textures.borrow_mut().insert(handle, asset);
        handle
    }

    pub fn add_texture(&mut self, desc: TextureInfo) -> TextureHandle {
        let handle = TextureHandle::new();
        let asset = TextureAsset::Unloaded(desc);
        self.textures.borrow_mut().insert(handle, asset);
        handle
    }

    pub fn textures(&self) -> Vec<(TextureHandle, Rc<Texture>)> {
        let keys = self.textures.borrow().keys().cloned().collect::<Vec<_>>();
        keys.into_iter()
            .filter_map(|k| match self.texture(k) {
                Some(texture) => Some((k, texture)),
                None => None,
            })
            .collect()
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

    pub fn texture(&self, handle: TextureHandle) -> Option<Rc<Texture>> {
        let mut textures = self.textures.borrow_mut();
        if let Some(asset) = textures.get(&handle) {
            if let TextureAsset::Loaded(te) = asset {
                return Some(te.clone());
            }
        }
        match textures.get(&handle) {
            Some(TextureAsset::Loaded(asset)) => {
                return Some(asset.clone());
            }
            Some(TextureAsset::Unloaded(desc)) => {
                let texture = self.load_texture2(desc).unwrap();
                textures.insert(handle, TextureAsset::Loaded(Rc::new(texture)));
            }
            None => return None,
        }
        if let Some(asset) = textures.get(&handle) {
            if let TextureAsset::Loaded(te) = asset {
                return Some(te.clone());
            }
        }

        unreachable!()
    }

    fn load_texture(gpu: &Gpu, desc: &TextureInfo) -> Result<Texture> {
        let texture = Texture::new2(
            gpu,
            &TextureInfo2 {
                name: desc.name.clone(),
                extent: desc.extent,
                format: desc.format,
                flags: desc.flags,
                aspect_flags: desc.aspect_flags,
                sampler: desc.sampler,
            },
        )?;

        gpu.execute(|cmd| texture.upload(cmd, &desc.data).expect("upload"))?;

        Ok(texture)
    }
    fn load_texture2(&self, info: &TextureInfo) -> Result<Texture> {
        let texture = Texture::new(&self.gpu, info)?;
        let mut uploader = self.uploader.borrow_mut();
        uploader.enqueue_image(&*texture, &info.data);

        Ok(texture)
    }

    pub fn material(&self, handle: MaterialHandle) -> Option<&Material> {
        self.materials.get(&handle)
    }

    pub fn add_material(&mut self, material: Material) -> Result<MaterialHandle> {
        let handle = MaterialHandle::new();
        self.materials.insert(handle, material);
        Ok(handle)
    }

    pub fn mesh(&self, handle: MeshHandle) -> Option<&Mesh> { self.meshes.get(&handle) }

    pub fn add_mesh(&mut self, desc: MeshInfo) -> Result<MeshHandle> {
        let mut primitives = vec![];
        for primitive_desc in &desc.primitives {
            let indices = &primitive_desc.indices;
            let vertices = &primitive_desc.vertices;

            let index_size = size_of::<u32>() as u64 * indices.len() as u64;
            let index_buffer = TypedBuffer::index(&self.gpu, index_size as usize, "index buffer")?;
            let index_staging: TypedBuffer<u32> =
                TypedBuffer::staging(&self.gpu, index_size, "index staging")?;

            let n_vertices = primitive_desc.indices.len() as u32;
            let vertex_size = size_of::<Vertex>() as u64 * vertices.len() as u64;
            let vertex_buffer =
                TypedBuffer::vertex(&self.gpu, vertex_size as usize, "vertex buffer")?;
            let vertex_staging: TypedBuffer<Vertex> =
                TypedBuffer::staging(&self.gpu, vertex_size, "vertex staging")?;

            self.gpu.execute(|cmd| {
                cmd.copy_buffer(&vertex_staging, &vertex_buffer, vertex_buffer.size());
                cmd.copy_buffer(&index_staging, &index_buffer, index_buffer.size());
            })?;

            primitives.push(Primitive {
                vertex_buffer,
                index_buffer,
                material: primitive_desc.material,
                vertex_count: n_vertices,
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
}
