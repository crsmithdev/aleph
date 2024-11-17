// use {anyhow::Result, ash::vk};

// pub struct ShaderDesc {
//     pub name: String,
//     pub path: String,
// }
// pub struct Shader {
//     pub inner: vk::ShaderModule,
// }

// impl Device {
//     pub fn load_shader(&self, path: &str) -> Result<Shader> {
//         let p = std::path::Path::new(path);
//         let p = std::path::absolute(p);
//         let mut file = std::fs::File::open(path)?;
//         let bytes = ash::util::read_spv(&mut file)?;
//         let info = vk::ShaderModuleCreateInfo::default().code(&bytes);
//         let shader = unsafe { self.inner.create_shader_module(&info, None) }?;

//         Ok(Shader { inner: shader })
//     }
// }
