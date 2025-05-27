use {
    crate::QueueFamily,
    anyhow::Result,
    ash::{
        ext, khr,
        vk::{self, Handle},
    },
    derive_more::{Debug, Deref},
    std::ffi,
};

const DEFAULT_APP_NAME: &ffi::CStr = c"Aleph";
const INSTANCE_LAYERS: [&ffi::CStr; 0] = [];
const INSTANCE_EXTENSIONS: [&ffi::CStr; 4] = [
    khr::surface::NAME,
    khr::win32_surface::NAME,
    khr::get_physical_device_properties2::NAME,
    ext::debug_utils::NAME,
];

#[allow(dead_code)]
#[derive(Clone, Debug, Deref)]
pub struct Instance {
    #[deref]
    #[debug("{:#x}", handle.handle().as_raw())]
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

        Ok(Instance {
            handle: inner,
            entry,
        })
    }

    pub fn handle(&self) -> &ash::Instance { &self.handle }

    pub fn enumerate_physical_devices(&self) -> Result<Vec<vk::PhysicalDevice>> {
        Ok(unsafe { self.handle.enumerate_physical_devices() }?)
    }

    pub fn get_physical_device_queue_family_properties(
        &self,
        physical_device: vk::PhysicalDevice,
    ) -> Vec<vk::QueueFamilyProperties> {
        unsafe { self.handle.get_physical_device_queue_family_properties(physical_device) }
    }

    pub fn get_physical_device_properties(
        &self,
        physical_device: vk::PhysicalDevice,
    ) -> vk::PhysicalDeviceProperties {
        unsafe { self.handle.get_physical_device_properties(physical_device) }
    }

    pub fn get_physical_device_features2(
        &self,
        physical_device: vk::PhysicalDevice,
    ) -> vk::PhysicalDeviceFeatures2 {
        let mut features = vk::PhysicalDeviceFeatures2::default();
        unsafe {
            self.handle.get_physical_device_features2(physical_device, &mut features);
        }
        features
    }

    pub fn create_device(
        &self,
        physical_device: vk::PhysicalDevice,
        queue_families: [QueueFamily; 2],
        extension_names: &[*const ffi::c_char],
        features: &mut vk::PhysicalDeviceFeatures2,
    ) -> Result<ash::Device> {
        let priorities = [1.0];
        let queue_infos = [
            vk::DeviceQueueCreateInfo::default()
                .queue_family_index(queue_families[0].index)
                .queue_priorities(&priorities),
            vk::DeviceQueueCreateInfo::default()
                .queue_family_index(queue_families[1].index)
                .queue_priorities(&priorities),
        ];
        let device_info = vk::DeviceCreateInfo::default()
            .queue_create_infos(&queue_infos)
            .enabled_extension_names(extension_names)
            .push_next(features);

        Ok(unsafe { self.handle.create_device(physical_device, &device_info, None) }?)
    }
}
