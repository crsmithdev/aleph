use {
    crate::{
        model::{MeshDesc, TextureDesc},
        util, Material, Mesh, Primitive, Vertex,
    },
    aleph_vk::{
        AllocatedTexture, Filter, Format, Gpu, ImageAspectFlags, ImageUsageFlags, MemoryLocation,
        Sampler, SamplerAddressMode, SamplerMipmapMode,
    },
    anyhow::Result,
    std::{
        collections::HashMap,
        hash::Hash,
        sync::{
            atomic::{AtomicU64, Ordering},
            Arc,
        },
    },
};

static HANDLE_INDEX: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
pub struct AssetHandle<T> {
    index: u64,
    marker: std::marker::PhantomData<T>,
}

impl<T> AssetHandle<T> {
    pub fn new() -> Self {
        let index = HANDLE_INDEX.fetch_add(1, Ordering::Relaxed);
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

impl<T> Copy for AssetHandle<T> {}
impl<T> Clone for AssetHandle<T> {
    fn clone(&self) -> Self { *self }
}

impl<T> Eq for AssetHandle<T> {}
impl<T> PartialEq for AssetHandle<T> {
    fn eq(&self, other: &Self) -> bool { self.index == other.index }
}
impl<T> Hash for AssetHandle<T> {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) { self.index.hash(state); }
}

pub type MeshHandle = AssetHandle<Mesh>;
pub type TextureHandle = AssetHandle<AllocatedTexture>;
pub type MaterialHandle = AssetHandle<Material>;

pub struct Defaults {
    pub white_srgb: TextureHandle,
    pub black_srgb: TextureHandle,
    pub black_linear: TextureHandle,
    pub white_linear: TextureHandle,
    pub normal: TextureHandle,
    pub sampler: Sampler,
    pub material: MaterialHandle,
}

const WHITE: [f32; 4] = [1., 1., 1., 1.];
const BLACK: [f32; 4] = [0., 0., 0., 1.];
const NORMAL: [f32; 4] = [0.5, 0.5, 1., 1.];

pub struct Assets {
    gpu: Arc<Gpu>,
    meshes: HashMap<MeshHandle, Mesh>,
    textures: HashMap<TextureHandle, AllocatedTexture>,
    materials: HashMap<MaterialHandle, Material>,
    pub defaults: Defaults,
}

impl Assets {
    pub fn new(gpu: Arc<Gpu>) -> Result<Self> {
        let mut textures = HashMap::new();
        let mut materials = HashMap::new();
        let meshes = HashMap::new();

        let defaults = Self::load_default_textures(&gpu, &mut textures, &mut materials)?;

        Ok(Self {
            gpu,
            meshes,
            textures,
            materials,
            defaults,
        })
    }

    pub fn load_default_textures(
        gpu: &Gpu,
        textures: &mut HashMap<TextureHandle, AllocatedTexture>,
        materials: &mut HashMap<MaterialHandle, Material>,
    ) -> Result<Defaults> {
        let white_srgb = TextureHandle::new();
        textures.insert(
            white_srgb,
            AllocatedTexture::monochrome(gpu, WHITE, Format::R8G8B8A8_SRGB, "white-srgb")?,
        );

        let black_srgb = TextureHandle::new();
        textures.insert(
            black_srgb,
            AllocatedTexture::monochrome(gpu, BLACK, Format::R8G8B8A8_SRGB, "black-srgb")?,
        );

        let black_linear = TextureHandle::new();
        textures.insert(
            black_linear,
            AllocatedTexture::monochrome(gpu, BLACK, Format::R8G8B8A8_UNORM, "black-linear")?,
        );

        let white_linear = TextureHandle::new();
        textures.insert(
            white_linear,
            AllocatedTexture::monochrome(gpu, WHITE, Format::R8G8B8A8_UNORM, "white-linear")?,
        );

        let normal = TextureHandle::new();
        textures.insert(
            normal,
            AllocatedTexture::monochrome(gpu, NORMAL, Format::R8G8B8A8_UNORM, "normal")?,
        );

        let sampler = gpu.create_sampler(
            Filter::LINEAR,
            Filter::LINEAR,
            SamplerMipmapMode::LINEAR,
            SamplerAddressMode::REPEAT,
            SamplerAddressMode::REPEAT,
        )?;

        let material = MaterialHandle::new();
        materials.insert(material, Material::default());

        Ok(Defaults {
            white_srgb,
            black_srgb,
            black_linear,
            white_linear,
            normal,
            sampler,
            material,
        })
    }
    pub fn material(&self, handle: MaterialHandle) -> Option<&Material> {
        self.materials.get(&handle)
    }

    pub fn add_material(&mut self, material: Material) -> Result<MaterialHandle> {
        let handle = MaterialHandle::new();
        self.materials.insert(handle, material);
        Ok(handle)
    }

    pub fn texture(&self, handle: TextureHandle) -> Option<&AllocatedTexture> {
        self.textures.get(&handle)
    }

    pub fn add_texture(&mut self, texture: AllocatedTexture) -> Result<TextureHandle> {
        let handle = TextureHandle::new();
        self.textures.insert(handle, texture);
        Ok(handle)
    }

    pub fn load_texture(&mut self, desc: TextureDesc) -> Result<TextureHandle> {
        let sampler = self.gpu.create_sampler(
            desc.sampler.min_filter,
            desc.sampler.mag_filter,
            desc.sampler.mipmap_mode,
            desc.sampler.address_mode_u,
            desc.sampler.address_mode_y,
        )?;
        let image = self.gpu.create_texture(
            desc.extent,
            desc.format,
            ImageUsageFlags::TRANSFER_DST | ImageUsageFlags::SAMPLED,
            ImageAspectFlags::COLOR,
            &desc.name,
            Some(sampler),
        )?;

        self.gpu
            .execute(|cmd| image.upload(cmd, &desc.data).expect("upload"))?;

        let handle = TextureHandle::new();
        self.textures.insert(handle, image);

        log::debug!(
            "Loaded texture asset {}: {} ({} bytes, format: {:?}, {}x{})",
            handle,
            desc.name,
            desc.data.len(),
            desc.format,
            desc.extent.width,
            desc.extent.height,
        );

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
