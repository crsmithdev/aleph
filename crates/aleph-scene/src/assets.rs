use {
    crate::{model::MeshDesc, util, Material, Mesh, Primitive, Vertex},
    aleph_vk::{
        texture::{SamplerDesc, TextureDesc},
        AllocatedTexture, Extent2D, Filter, Format, Gpu, ImageAspectFlags, ImageUsageFlags,
        MemoryLocation, PrimitiveTopology, Sampler, SamplerAddressMode, SamplerMipmapMode,
    },
    anyhow::Result,
    image::{ImageBuffer, Rgba},
    std::{
        cell::RefCell,
        collections::HashMap,
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

#[derive(Debug)]
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
        write!(f, "{}", self.index)
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
pub type TextureHandle = AssetHandle<AllocatedTexture>;
pub type MaterialHandle = AssetHandle<Material>;

pub struct Defaults {
    pub white_srgb: Rc<AllocatedTexture>,
    pub white_linear: Rc<AllocatedTexture>,
    pub normal: Rc<AllocatedTexture>,
    pub sampler: Sampler,
}

impl Defaults {}

enum Asset<T, D> {
    Loaded(Rc<T>),
    Unloaded(D),
}

type TextureAsset = Asset<AllocatedTexture, TextureDesc>;

type AssetCache<T, D> = RefCell<HashMap<AssetHandle<T>, Asset<T, D>>>;

pub struct Assets {
    gpu: Arc<Gpu>,
    meshes: HashMap<MeshHandle, Mesh>,
    textures: AssetCache<AllocatedTexture, TextureDesc>,
    materials: HashMap<MaterialHandle, Material>,
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

        Ok(Self {
            gpu,
            meshes,
            textures,
            materials,
            defaults,
        })
    }

    pub fn create_default(
        gpu: &Gpu,
        color: &[u8; 4],
        format: Format,
        sampler: Sampler,
        name: impl Into<String>,
    ) -> Result<AllocatedTexture> {
        let pixel = Rgba::<u8>(*color);
        let buffer = ImageBuffer::from_pixel(16, 16, pixel);
        let data = buffer.as_raw();
        println!("data: {:?}", data);

        Self::load_texture(
            gpu,
            &TextureDesc {
                name: name.into(),
                data: data.to_vec(),
                extent: Self::DEFAULT_EXTENT,
                usage: ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
                aspect: ImageAspectFlags::COLOR,
                format,
                sampler: SamplerDesc::default(),
            },
        )
    }

    fn load_defaults(gpu: &Gpu) -> Result<Defaults> {
        let srgb = Format::R8G8B8A8_SRGB;
        let linear = Format::R8G8B8A8_UNORM;

        let sampler = gpu.create_sampler(&SamplerDesc::default())?;
        let white_srgb = Self::create_default(gpu, &WHITE, srgb, sampler, "white-srgb")?;
        let sampler = gpu.create_sampler(&SamplerDesc::default())?;
        let white_linear = Self::create_default(gpu, &WHITE, linear, sampler, "white-linear")?;
        let sampler = gpu.create_sampler(&SamplerDesc::default())?;
        let normal = Self::create_default(gpu, &NORMAL, linear, sampler, "normal")?;

        Ok(Defaults {
            white_srgb: Rc::new(white_srgb),
            white_linear: Rc::new(white_linear),
            normal: Rc::new(normal),
            sampler,
        })
    }

    pub fn add_texture(&mut self, desc: TextureDesc) -> TextureHandle {
        let handle = TextureHandle::new();
        let asset = TextureAsset::Unloaded(desc);
        self.textures.borrow_mut().insert(handle, asset);
        handle
    }

    pub fn texture(&self, handle: TextureHandle) -> Option<Rc<AllocatedTexture>> {
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
                let texture = Self::load_texture(&self.gpu, &desc).unwrap();
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

    fn get_loaded_texture(
        &self,
        handle: AssetHandle<AllocatedTexture>,
    ) -> Option<Rc<AllocatedTexture>> {
        if let Some(asset) = self.textures.borrow().get(&handle) {
            if let TextureAsset::Loaded(te) = asset {
                return Some(te.clone());
            }
        }
        None
    }

    fn load_texture(gpu: &Gpu, desc: &TextureDesc) -> Result<AllocatedTexture> {
        let sampler = gpu.create_sampler(&desc.sampler)?;
        let texture = gpu.create_texture(
            desc.extent,
            desc.format,
            ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
            ImageAspectFlags::COLOR,
            &desc.name,
            Some(sampler),
        )?;

        gpu.execute(|cmd| texture.upload(cmd, &desc.data).expect("upload"))?;

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

    pub fn load_mesh(&mut self, desc: MeshDesc) -> Result<MeshHandle> {
        let mut primitives = vec![];
        for primitive_desc in &desc.primitives {
            let indices = &primitive_desc.indices;
            let vertices = &primitive_desc.vertices;

            let index_size = size_of::<u32>() as u64 * indices.len() as u64;
            let index_buffer = self.gpu.create_index_buffer(
                index_size,
                MemoryLocation::GpuOnly,
                "index buffer",
            )?;
            let index_staging = util::staging_buffer(&self.gpu, indices, "index staging")?;

            let n_vertices = primitive_desc.indices.len() as u32;
            let vertex_size = size_of::<Vertex>() as u64 * vertices.len() as u64;
            let vertex_buffer = self.gpu.create_vertex_buffer(
                vertex_size,
                MemoryLocation::GpuOnly,
                "vertex buffer",
            )?;
            let vertex_staging = util::staging_buffer(&self.gpu, vertices, "vertex staging")?;

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
