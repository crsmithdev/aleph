use {
    crate::QueueFamily,
    anyhow::Result,
    ash::{
        ext::debug_utils,
        khr::{get_physical_device_properties2, surface, win32_surface},
        vk::{
            ApplicationInfo, DeviceCreateInfo, DeviceQueueCreateInfo, Handle, InstanceCreateFlags,
            InstanceCreateInfo, PhysicalDevice, PhysicalDeviceFeatures2, PhysicalDeviceProperties,
            QueueFamilyProperties, API_VERSION_1_3,
        },
        Device as VkDevice, Entry, Instance as VkInstance,
    },
    derive_more::{Debug, Deref},
    std::ffi,
    tracing::trace,
};

const DEFAULT_APP_NAME: &ffi::CStr = c"Aleph";
const INSTANCE_LAYERS: [&ffi::CStr; 0] = [];
const INSTANCE_EXTENSIONS: [&ffi::CStr; 4] = [
    surface::NAME,
    win32_surface::NAME,
    get_physical_device_properties2::NAME,
    debug_utils::NAME,
];

#[allow(dead_code)]
#[derive(Clone, Debug, Deref)]
pub struct Instance {
    #[deref]
    #[debug("{:#x}", handle.handle().as_raw())]
    pub(crate) handle: VkInstance,

    #[debug(skip)]
    pub(crate) entry: Entry,
}

impl Instance {
    pub fn new() -> Result<Self> {
        let entry = unsafe { Entry::load() }?;
        let layers: Vec<*const i8> = INSTANCE_LAYERS.iter().map(|n| n.as_ptr()).collect();
        let extensions: Vec<*const i8> = INSTANCE_EXTENSIONS.iter().map(|n| n.as_ptr()).collect();

        let app_info = ApplicationInfo::default()
            .application_name(DEFAULT_APP_NAME)
            .application_version(0)
            .engine_name(DEFAULT_APP_NAME)
            .engine_version(0)
            .api_version(API_VERSION_1_3);
        let instance_info = InstanceCreateInfo::default()
            .application_info(&app_info)
            .enabled_layer_names(&layers)
            .enabled_extension_names(&extensions)
            .flags(InstanceCreateFlags::default());

        let inner = unsafe { entry.create_instance(&instance_info, None)? };

        Ok(Instance {
            handle: inner,
            entry,
        })
    }

    pub fn handle(&self) -> &VkInstance { &self.handle }

    pub fn enumerate_physical_devices(&self) -> Result<Vec<PhysicalDevice>> {
        Ok(unsafe { self.handle.enumerate_physical_devices() }?)
    }

    pub fn get_physical_device_queue_family_properties(
        &self,
        physical_device: PhysicalDevice,
    ) -> Vec<QueueFamilyProperties> {
        unsafe { self.handle.get_physical_device_queue_family_properties(physical_device) }
    }

    pub fn get_physical_device_properties(
        &self,
        physical_device: PhysicalDevice,
    ) -> PhysicalDeviceProperties {
        unsafe { self.handle.get_physical_device_properties(physical_device) }
    }

    pub fn get_physical_device_features2(
        &self,
        physical_device: PhysicalDevice,
    ) -> PhysicalDeviceFeatures2 {
        let mut features = PhysicalDeviceFeatures2::default();
        unsafe {
            self.handle.get_physical_device_features2(physical_device, &mut features);
        }
        features
    }

    pub fn create_device(
        &self,
        physical_device: PhysicalDevice,
        queue_families: [QueueFamily; 2],
        extension_names: &[*const ffi::c_char],
        features: &mut PhysicalDeviceFeatures2,
    ) -> Result<VkDevice> {
        let priorities = [1.0];
        let queue_infos = [
            DeviceQueueCreateInfo::default()
                .queue_family_index(queue_families[0].index)
                .queue_priorities(&priorities),
            DeviceQueueCreateInfo::default()
                .queue_family_index(queue_families[1].index)
                .queue_priorities(&priorities),
        ];
        let device_info = DeviceCreateInfo::default()
            .queue_create_infos(&queue_infos)
            .enabled_extension_names(extension_names)
            .push_next(features);

        Ok(unsafe { self.handle.create_device(physical_device, &device_info, None) }?)
    }

    pub fn destroy(&mut self) {
        // unsafe {
        // self.handle.destroy_instance(None);
        // }
        trace!("Destroyed {self:?}");
    }
}
