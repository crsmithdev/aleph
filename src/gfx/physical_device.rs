use crate::gfx::surface::Surface;
use anyhow::{anyhow, Result};
use ash::{vk, vk::Handle};
use std::{fmt, sync::Arc};

#[derive(Copy, Clone)]
pub struct QueueFamily {
    pub index: u32,
    pub properties: vk::QueueFamilyProperties,
}

pub struct PhysicalDevice {
    pub inner: vk::PhysicalDevice,
    pub queue_families: Vec<QueueFamily>,
    pub properties: vk::PhysicalDeviceProperties,
    pub memory_properties: vk::PhysicalDeviceMemoryProperties,
}

impl fmt::Debug for PhysicalDevice {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PhysicalDevice")
            .field("inner", &format_args!("{:x}", &self.inner.as_raw()))
            .field("properties", &self.properties)
            .finish()
    }
}

impl PhysicalDevice {
    fn supports_surface(&self, surface: &Surface) -> bool {
        self.queue_families.iter().any(|f| unsafe {
            f.properties.queue_flags.contains(vk::QueueFlags::GRAPHICS)
                && surface
                    .fns
                    .get_physical_device_surface_support(self.inner, f.index, surface.inner)
                    .unwrap_or(false)
        })
    }
}

pub trait PhysicalDevices {
    fn with_surface_support(self, surface: &Surface) -> Self;
    fn select(self, rank_fn: fn(&PhysicalDevice) -> i32) -> Result<Arc<PhysicalDevice>>;
    fn select_default(self) -> Result<Arc<PhysicalDevice>>
    where
        Self: Sized,
    {
        let rank_fn: fn(&PhysicalDevice) -> i32 = rank_default;
        let selected = self.select(rank_fn);
        selected
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
    fn with_surface_support(self, surface: &Surface) -> Self {
        self.into_iter()
            .filter(|qf| qf.supports_surface(surface))
            .collect()
    }

    fn select(self, rank_fn: fn(&PhysicalDevice) -> i32) -> Result<Arc<PhysicalDevice>> {
        let selected = self.into_iter().rev().max_by_key(|d| rank_fn(d));
        selected.ok_or(anyhow!("err")).map(|d| Arc::new(d))
    }
}
