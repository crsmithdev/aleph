use {super::RenderBackend, crate::vk::device::Device, anyhow::Result, ash::vk};

pub struct ShaderDesc {
    pub name: String,
    pub path: String,
}
pub struct Shader {
    pub desc: ShaderDesc,
    pub inner: vk::ShaderModule,
}

impl RenderBackend {
    pub fn load_shader(&self, desc: ShaderDesc) -> Result<Shader> {
        let mut file = std::fs::File::open(&desc.path)?;
        let bytes = ash::util::read_spv(&mut file)?;
        let info = vk::ShaderModuleCreateInfo::default().code(&bytes);
        let shader = unsafe { self.inner.create_shader_module(&info, None) }?;

        Ok(Shader {
            inner: shader,
            desc,
        })
    }
}
