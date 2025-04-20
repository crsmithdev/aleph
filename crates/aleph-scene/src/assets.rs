use {
    crate::{
        model::{MeshDesc, TextureDesc},
        util, Material, Mesh, Primitive, Vertex,
    },
    aleph_vk::{
        AllocatedTexture, Extent2D, Filter, Format, Gpu, ImageAspectFlags, ImageUsageFlags,
        MemoryLocation, Sampler, SamplerAddressMode, SamplerMipmapMode,
    },
    anyhow::Result,
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
    tracing::instrument,
};

const WHITE: [f32; 4] = [1., 1., 1., 1.];
const NORMAL: [f32; 4] = [0.5, 0.5, 1., 1.];

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

impl Defaults {
    pub fn white_srgb(&self) -> Rc<AllocatedTexture> { self.white_srgb.clone() }
    pub fn white_linear(&self) -> Rc<AllocatedTexture> { self.white_linear.clone() }
    pub fn normal(&self) -> Rc<AllocatedTexture> { self.normal.clone() }
    pub fn sampler(&self) -> Sampler { self.sampler }
}

enum TextureAsset {
    Loaded(Rc<AllocatedTexture>),
    Unloaded(TextureDesc),
}

pub struct Assets {
    gpu: Arc<Gpu>,
    meshes: HashMap<MeshHandle, Mesh>,
    textures: RefCell<HashMap<TextureHandle, TextureAsset>>,
    materials: HashMap<MaterialHandle, Material>,
    pub defaults: Defaults,
}

impl Assets {
    const DEFAULT_EXTENT: Extent2D = Extent2D {
        width: 16,
        height: 16,
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
        color: &[f32; 4],
        format: Format,
        sampler: Sampler,
        name: impl Into<String>,
    ) -> Result<AllocatedTexture> {
        Self::load_texture(
            gpu,
            &TextureDesc {
                name: name.into(),
                extent: Self::DEFAULT_EXTENT,
                format,
                data: bytemuck::bytes_of(color).to_vec(),
                usage: ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
                aspect: ImageAspectFlags::COLOR,
            },
            sampler,
        )
    }

    #[instrument(skip(gpu))]
    pub fn load_defaults(gpu: &Gpu) -> Result<Defaults> {
        let srgb = Format::R8G8B8A8_SRGB;
        let linear = Format::R8G8B8A8_UNORM;
        let sampler = gpu.create_sampler(
            Filter::LINEAR,
            Filter::LINEAR,
            SamplerMipmapMode::LINEAR,
            SamplerAddressMode::REPEAT,
            SamplerAddressMode::REPEAT,
        )?;
        let white_srgb = Rc::new(Self::create_default(
            gpu,
            &WHITE,
            srgb,
            sampler,
            "tx-white-srgb",
        )?);
        let white_linear = Rc::new(Self::create_default(
            gpu,
            &WHITE,
            linear,
            sampler,
            "tx-white-linear",
        )?);
        let normal = Rc::new(Self::create_default(
            gpu,
            &NORMAL,
            srgb,
            sampler,
            "tx-normal",
        )?);

        Ok(Defaults {
            white_srgb,
            white_linear,
            normal,
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
        match textures.get(&handle) {
            Some(TextureAsset::Loaded(asset)) => {
                return Some(asset.clone());
            }
            Some(TextureAsset::Unloaded(desc)) => {
                let texture = Self::load_texture(&self.gpu, &desc, self.defaults.sampler).unwrap();
                textures.insert(handle, TextureAsset::Loaded(Rc::new(texture)));
            }
            None => return None,
        }

        self.get_loaded_texture(handle)
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

    fn load_texture(gpu: &Gpu, desc: &TextureDesc, sampler: Sampler) -> Result<AllocatedTexture> {
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

            let n_vertices = primitive_desc.vertices.len() as u32;
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
