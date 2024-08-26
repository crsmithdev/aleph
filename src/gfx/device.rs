use crate::gfx::instance::Instance;
use crate::gfx::surface::Surface;
use anyhow::{anyhow, Result};
use ash::vk;
use ash::vk::Handle;
use std::fmt;
use std::sync::Arc;

#[derive(Copy, Clone)]
pub struct QueueFamily {
    pub index: u32,
    pub properties: vk::QueueFamilyProperties,
}

pub struct PhysicalDevice {
    pub instance: Arc<Instance>,
    pub raw: vk::PhysicalDevice,
    pub queue_families: Vec<QueueFamily>,
    pub presentation_requested: bool,
    pub properties: vk::PhysicalDeviceProperties,
    pub memory_properties: vk::PhysicalDeviceMemoryProperties,
}

impl fmt::Debug for PhysicalDevice {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PhysicalDevice")
            .field("raw", &self.raw.as_raw())
            .finish()
    }
}

impl PhysicalDevice {

    pub fn get_physical_devices(instance: Arc<Instance>) -> impl PhysicalDevices {
        unsafe { instance.raw.enumerate_physical_devices().unwrap().into_iter().map(|d| PhysicalDevice::from_raw(d, &instance)).collect::<Vec<PhysicalDevice>>()}
        }

    pub fn from_raw(device: vk::PhysicalDevice, instance: &Arc<Instance>) -> Self {
        unsafe {
            let properties = instance.raw.get_physical_device_properties(device);

            let queue_families = instance.raw

                .get_physical_device_queue_family_properties(device)
                .into_iter()
                .enumerate()
                .map(|(index, properties)| QueueFamily {
                    index: index as _,
                    properties,
                })
                .collect();

            let memory_properties = instance.raw.get_physical_device_memory_properties(device);

            Self {
                raw: device,
                queue_families,
                presentation_requested: true,
                instance: instance.clone(),
                properties,
                memory_properties,
            }
        }
    }

    fn supports_extension(&self, _extension: &str) -> bool {
        todo!()
    }

    fn supports_surface(&self, surface: &Surface) -> bool {
        self.queue_families.iter().any(|f| unsafe {
            f.properties.queue_flags.contains(vk::QueueFlags::GRAPHICS)
                && surface
                    .fns
                    .get_physical_device_surface_support(self.raw, f.index, surface.raw)
                    .unwrap_or(false)
        })
    }
}

pub trait PhysicalDevices {
    fn with_extension_support(self, extension: &str) -> Self;
    fn with_surface_support(self, surface: &Surface) -> Self;
    fn select(&self, rank_fn: fn(&PhysicalDevice) -> i32) -> Result<&PhysicalDevice>;
    fn select_default(&self) -> Result<&PhysicalDevice> {
        let rank_fn: fn(&PhysicalDevice) -> i32 = rank_default;
        self.select(rank_fn)
    }
}

fn rank_default(device: &PhysicalDevice) -> i32 {
    match device.properties.device_type {
        vk::PhysicalDeviceType::INTEGRATED_GPU => 200,
        vk::PhysicalDeviceType::DISCRETE_GPU => 1000,
        vk::PhysicalDeviceType::VIRTUAL_GPU => 1,
        _ => 0,
    }
}

impl PhysicalDevices for Vec<PhysicalDevice> {
    fn with_extension_support(self, extension: &str) -> Self {
        self.into_iter()
            .filter(|qf| qf.supports_extension(extension))
            .collect()
    }

    fn with_surface_support(self, surface: &Surface) -> Self {
        self.into_iter()
            .filter(|qf| qf.supports_surface(surface))
            .collect()
    }

    fn select(&self, rank_fn: fn(&PhysicalDevice) -> i32) -> Result<&PhysicalDevice> {
        self.into_iter()
            .rev()
            .max_by_key(|d| rank_fn(d))
            .ok_or(anyhow!("err"))
    }
}
