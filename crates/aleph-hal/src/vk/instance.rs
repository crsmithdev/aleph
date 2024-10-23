use {
    crate::vk::debug::vulkan_debug_callback,
    anyhow::Result,
    ash::{ext, ext::debug_utils, khr, vk},
    std::{ffi, fmt, sync::Arc},
    winit::window::Window,
};

pub struct Instance {
    pub inner: ash::Instance,
    pub entry: ash::Entry,
    pub debug_utils: Option<ext::debug_utils::Instance>,
    pub debug_callback: Option<vk::DebugUtilsMessengerEXT>,
}

impl fmt::Debug for Instance {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Instance")
            .field("inner", &self.inner.handle())
            .field(
                "entry",
                &format_args!("{:?}", self.inner.fp_v1_3() as *const _),
            )
            // TODO .field("debug_utils", &debug_utils)
            .field("debug_callback", &self.debug_callback)
            .finish_non_exhaustive()
    }
}

#[derive(Debug)]
pub struct InstanceBuilder {
    pub window: Arc<Window>,
    pub debug: bool,
    pub extensions: Vec<*const i8>,
    pub name: Option<String>,
}

impl InstanceBuilder {
    pub fn build(self) -> Result<Arc<Instance>> {
        Instance::build(&self)
    }

    pub fn debug(mut self, debug: bool) -> Self {
        self.debug = debug;
        self
    }
}

impl Instance {
    pub fn builder(window: Arc<Window>) -> InstanceBuilder {
        InstanceBuilder {
            window: window.clone(),
            debug: false,
            extensions: vec![],
            name: None,
        }
    }

    fn vk_extensions(builder: &InstanceBuilder) -> Vec<*const i8> {
        let mut extensions: Vec<*const i8> = vec![
            khr::surface::NAME.as_ptr(),
            khr::win32_surface::NAME.as_ptr(),
            khr::get_physical_device_properties2::NAME.as_ptr(),
        ];
        if builder.debug {
            extensions.push(debug_utils::NAME.as_ptr());
        }
        extensions
    }

    fn vk_layers() -> Vec<*const i8> {
        unsafe {
            [
                ffi::CStr::from_bytes_with_nul_unchecked(b"VK_LAYER_LUNARG_api_dump\0"),
                ffi::CStr::from_bytes_with_nul_unchecked(b"VK_LAYER_KHRONOS_validation\0"),
            ]
            .iter()
            .map(|n| n.as_ptr())
            .collect()
        }
    }

    pub fn build(builder: &InstanceBuilder) -> Result<Arc<Self>> {
        log::info!("Instance build: {:?}", builder);

        let entry = unsafe { ash::Entry::load()? };
        let extension_names = Self::vk_extensions(builder);
        let layer_names = Self::vk_layers();

        let app_name = ffi::CString::new(match builder.name {
            Some(ref name) => name,
            None => "Untitled",
        })?;
        let app_info = vk::ApplicationInfo::default()
            .application_name(&app_name)
            .application_version(0)
            .engine_name(&app_name)
            .engine_version(0)
            .api_version(vk::make_api_version(0, 1, 3, 0));
        let create_info = vk::InstanceCreateInfo::default()
            .application_info(&app_info)
            .enabled_layer_names(&layer_names)
            .enabled_extension_names(&extension_names)
            .flags(vk::InstanceCreateFlags::default());

        let instance: ash::Instance = unsafe { entry.create_instance(&create_info, None)? };

        let (debug_utils, debug_callback) = if builder.debug {
            let debug_info = vk::DebugUtilsMessengerCreateInfoEXT::default()
                .message_severity(
                    vk::DebugUtilsMessageSeverityFlagsEXT::ERROR
                        | vk::DebugUtilsMessageSeverityFlagsEXT::WARNING
                        | vk::DebugUtilsMessageSeverityFlagsEXT::INFO,
                )
                .message_type(
                    vk::DebugUtilsMessageTypeFlagsEXT::GENERAL
                        | vk::DebugUtilsMessageTypeFlagsEXT::VALIDATION
                        | vk::DebugUtilsMessageTypeFlagsEXT::PERFORMANCE,
                )
                .pfn_user_callback(Some(vulkan_debug_callback));
            let debug_utils = debug_utils::Instance::new(&entry, &instance);
            let debug_callback = unsafe {
                debug_utils
                    .create_debug_utils_messenger(&debug_info, None)
                    .unwrap()
            };
            (Some(debug_utils), Some(debug_callback))
        } else {
            (None, None)
        };

        Ok(Arc::new(Self {
            entry,
            inner: instance,
            debug_utils,
            debug_callback,
        }))
    }
}
