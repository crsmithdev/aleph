use {
    crate::QueueFamily,
    anyhow::Result,
    ash::{
        ext,
        khr,
        vk::{self, Handle},
    },
    derive_more::Debug,
    std::ffi,
};

const DEFAULT_APP_NAME: &ffi::CStr = c"Aleph";
const INSTANCE_LAYERS: [&ffi::CStr; 0] = [
    // c"VK_LAYER_KHRONOS_validation",
];
const INSTANCE_EXTENSIONS: [&ffi::CStr; 4] = [
    khr::surface::NAME,
    khr::win32_surface::NAME,
    khr::get_physical_device_properties2::NAME,
    ext::debug_utils::NAME,
];

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub struct Instance {
    #[debug("{:x}", handle.handle().as_raw())]
    pub(crate) handle: ash::Instance,

    #[debug(skip)]
    pub(crate) entry: ash::Entry,
}

impl Instance {
    pub fn new() -> Result<Self> {
        let entry = unsafe { ash::Entry::load() }?;
        let layers: Vec<*const i8> = INSTANCE_LAYERS.iter().map(|n| n.as_ptr()).collect();
        let extensions: Vec<*const i8> = INSTANCE_EXTENSIONS.iter().map(|n| n.as_ptr()).collect();

        let app_info = vk::ApplicationInfo::default()
            .application_name(DEFAULT_APP_NAME)
            .application_version(0)
            .engine_name(DEFAULT_APP_NAME)
            .engine_version(0)
            .api_version(vk::make_api_version(0, 1, 4, 0));
        let instance_info = vk::InstanceCreateInfo::default()
            .application_info(&app_info)
            .enabled_layer_names(&layers)
            .enabled_extension_names(&extensions)
            .flags(vk::InstanceCreateFlags::default());

        let inner = unsafe { entry.create_instance(&instance_info, None)? };
        Self::create_debug(&entry, &inner)?;

        Ok(Instance {
            handle: inner,
            entry,
        })
    }

    fn create_debug(
        entry: &ash::Entry,
        instance: &ash::Instance,
    ) -> Result<(ext::debug_utils::Instance, vk::DebugUtilsMessengerEXT)> {
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
        let debug_utils = ext::debug_utils::Instance::new(entry, instance);
        let debug_callback = unsafe {
            debug_utils
                .create_debug_utils_messenger(&debug_info, None)
                .unwrap()
        };

        Ok((debug_utils, debug_callback))
    }

    pub fn handle(&self) -> &ash::Instance {
        &self.handle
    }

    pub fn enumerate_physical_devices(&self) -> Result<Vec<vk::PhysicalDevice>> {
        Ok(unsafe { self.handle.enumerate_physical_devices() }?)
    }

    pub fn get_physical_device_queue_family_properties(
        &self,
        physical_device: vk::PhysicalDevice,
    ) -> Vec<vk::QueueFamilyProperties> {
        unsafe {
            self.handle
                .get_physical_device_queue_family_properties(physical_device)
        }
    }

    pub fn get_physical_device_properties(
        &self,
        physical_device: vk::PhysicalDevice,
    ) -> vk::PhysicalDeviceProperties {
        unsafe { self.handle.get_physical_device_properties(physical_device) }
    }

    pub fn create_device(
        &self,
        physical_device: vk::PhysicalDevice,
        queue_family: QueueFamily,
        extension_names: &[*const ffi::c_char],
        features: &mut vk::PhysicalDeviceFeatures2,
    ) -> Result<ash::Device> {
        let priorities = [1.0];
        let queue_info = [vk::DeviceQueueCreateInfo::default()
            .queue_family_index(queue_family.index)
            .queue_priorities(&priorities)];
        let device_info = vk::DeviceCreateInfo::default()
            .queue_create_infos(&queue_info)
            .enabled_extension_names(extension_names)
            .push_next(features);

        Ok(unsafe {
            self.handle
                .create_device(physical_device, &device_info, None)
        }?)
    }
}

#[allow(clippy::missing_safety_doc)]
pub unsafe extern "system" fn vulkan_debug_callback(
    message_severity: vk::DebugUtilsMessageSeverityFlagsEXT,
    _message_type: vk::DebugUtilsMessageTypeFlagsEXT,
    p_callback_data: *const vk::DebugUtilsMessengerCallbackDataEXT,
    _p_user_data: *mut ffi::c_void,
) -> vk::Bool32 {
    let message = ffi::CStr::from_ptr((*p_callback_data).p_message)
        .to_str()
        .unwrap_or("[Error parsing message data]");

    match message_severity {
        vk::DebugUtilsMessageSeverityFlagsEXT::ERROR => log::error!("{}", message),
        vk::DebugUtilsMessageSeverityFlagsEXT::WARNING => log::warn!("{}", message),
        vk::DebugUtilsMessageSeverityFlagsEXT::VERBOSE => log::trace!("{}", message),
        _ => log::info!("{}", message),
    }

    vk::FALSE
}
