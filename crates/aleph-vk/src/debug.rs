use {
    crate::{CommandBuffer, Device, Instance},
    ash::{
        ext::debug_utils,
        vk::{self, DebugUtilsLabelEXT, DebugUtilsMessageSeverityFlagsEXT, Handle},
    },
    derive_more::derive::Debug,
    std::ffi,
};

#[derive(Clone, Debug)]
pub struct DebugUtils {
    #[debug(skip)]
    pub debug_instance: debug_utils::Instance,
    #[debug(skip)]
    pub debug_device: debug_utils::Device,
    pub debug_callback: vk::DebugUtilsMessengerEXT,
}

impl DebugUtils {
    pub fn new(instance: &Instance, device: &Device) -> Self {
        let instance = instance.clone();

        let debug_info = vk::DebugUtilsMessengerCreateInfoEXT::default()
            .message_severity(
                vk::DebugUtilsMessageSeverityFlagsEXT::ERROR
                    | vk::DebugUtilsMessageSeverityFlagsEXT::WARNING
                    | vk::DebugUtilsMessageSeverityFlagsEXT::INFO,
            )
            .message_type(
                vk::DebugUtilsMessageTypeFlagsEXT::GENERAL
                    | vk::DebugUtilsMessageTypeFlagsEXT::DEVICE_ADDRESS_BINDING
                    | vk::DebugUtilsMessageTypeFlagsEXT::VALIDATION
                    | vk::DebugUtilsMessageTypeFlagsEXT::PERFORMANCE,
            )
            .pfn_user_callback(Some(vulkan_debug_callback));
        let debug_instance = debug_utils::Instance::new(&instance.entry, &*instance);
        let debug_device = debug_utils::Device::new(&*instance, &*device);
        let debug_callback =
            unsafe { debug_instance.create_debug_utils_messenger(&debug_info, None).unwrap() };

        Self {
            debug_instance,
            debug_device,
            debug_callback,
        }
    }

    pub fn set_debug_object_name(&self, handle: impl Handle, name: &str) {
        unsafe {
            let name_c = ffi::CString::new(name).unwrap();
            let name_info = vk::DebugUtilsObjectNameInfoEXT::default()
                .object_handle(handle)
                .object_name(&name_c);
            self.debug_device
                .set_debug_utils_object_name(&name_info)
                .expect(&format!("Could not set name '{}'", name));
        }
    }

    pub fn begin_debug_label(&self, cmd_buffer: &CommandBuffer, name: &str) {
        unsafe {
            let name_c = ffi::CString::new(name).unwrap();
            let marker = DebugUtilsLabelEXT::default().label_name(&name_c);
            self.debug_device.cmd_begin_debug_utils_label(**cmd_buffer, &marker);
        }
        log::trace!("Began {name:?} in {:?}", cmd_buffer);
    }

    pub fn end_debug_label(&self, cmd_buffer: &CommandBuffer) {
        unsafe {
            self.debug_device.cmd_end_debug_utils_label(**cmd_buffer);
        }
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
        DebugUtilsMessageSeverityFlagsEXT::ERROR => log::error!("{}", message),
        DebugUtilsMessageSeverityFlagsEXT::WARNING => log::warn!("{}", message),
        DebugUtilsMessageSeverityFlagsEXT::VERBOSE => log::trace!("{}", message),
        _ => {}
    }

    vk::FALSE
}
