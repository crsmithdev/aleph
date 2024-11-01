use {
    crate::vk::{
        debug::vulkan_debug_callback,
        physical_device::{PhysicalDevice, PhysicalDevices},
        queue::QueueFamily,
    },
    anyhow::Result,
    ash::{
        ext::{self, debug_utils},
        khr,
        vk,
    },
    std::{
        ffi::{self, CString},
        fmt,
        sync::Arc,
    },
    winit::window::Window,
};

pub struct InstanceInfo<'a> {
    pub window: &'a Arc<Window>,
    pub debug: bool,
}

pub struct Instance {
    pub inner: ash::Instance,
    pub entry: ash::Entry,
    pub debug_utils: Option<ext::debug_utils::Instance>,
    pub debug_callback: Option<vk::DebugUtilsMessengerEXT>,
}

impl Instance {
    fn layer_names() -> Vec<*const i8> {
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

    fn extension_names() -> Vec<*const i8> {
        vec![
            khr::surface::NAME.as_ptr(),
            khr::win32_surface::NAME.as_ptr(),
            khr::get_physical_device_properties2::NAME.as_ptr(),
            khr::buffer_device_address::NAME.as_ptr(),
            debug_utils::NAME.as_ptr(),
        ]
    }

    pub fn new(info: &InstanceInfo) -> Result<Self> {
        let entry = unsafe { ash::Entry::load()? };

        let layer_names = Self::layer_names();
        let extension_names = Self::extension_names();
        let app_name = &CString::new("untitled")?;

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

        let (debug_utils, debug_callback) = if info.debug {
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

        Ok(Self {
            entry,
            inner: instance,
            debug_utils,
            debug_callback,
        })
    }

    pub fn physical_devices(&self) -> Result<PhysicalDevices> {
        unsafe {
            let devices = self
                .inner
                .enumerate_physical_devices()?
                .into_iter()
                .map(|d| self.create_physical_device(d))
                .collect();

            Ok(PhysicalDevices {
                inner: devices,
                features: vec![],
            })
        }
    }

    fn create_physical_device(&self, physical_device: vk::PhysicalDevice) -> PhysicalDevice {
        unsafe {
            let instance = &self.inner;
            let properties = instance.get_physical_device_properties(physical_device);
            let memory_properties = instance.get_physical_device_memory_properties(physical_device);
            let queue_families = instance
                .get_physical_device_queue_family_properties(physical_device)
                .into_iter()
                .enumerate()
                .map(|(i, properties)| QueueFamily {
                    index: i as _,
                    properties,
                })
                .collect();

            PhysicalDevice {
                inner: physical_device,
                queue_families,
                properties,
                memory_properties,
            }
        }
    }
}

impl fmt::Debug for Instance {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let debug_utils = match &self.debug_utils {
            Some(debug_utils) => &format!("{:?}", debug_utils.instance()),
            None => "None",
        };
        f.debug_struct("Instance")
            .field("inner", &self.inner.handle())
            .field(
                "entry",
                &format_args!("{:?}", self.inner.fp_v1_3() as *const _),
            )
            .field("debug_utils", &debug_utils)
            .field("debug_callback", &self.debug_callback)
            .finish_non_exhaustive()
    }
}
