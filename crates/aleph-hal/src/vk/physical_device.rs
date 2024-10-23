use {
    super::render_backend::RenderBackend,
    crate::vk::{instance::Instance, queue::QueueFamily, surface::Surface},
    anyhow::{anyhow, Result},
    ash::{vk, vk::Handle},
    std::{fmt, sync::Arc},
};

#[derive(Clone)]
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
            .finish_non_exhaustive()
    }
}

impl PhysicalDevice {
    pub fn supports_surface(&self, surface: &Surface) -> bool {
        self.queue_families.iter().any(|f| unsafe {
            f.properties.queue_flags.contains(vk::QueueFlags::GRAPHICS)
                && surface
                    .loader
                    .get_physical_device_surface_support(self.inner, f.index, surface.inner)
                    .unwrap_or(false)
        })
    }
}

impl RenderBackend {
    fn create_physical_device(
        instance: &Arc<Instance>,
        physical_device: vk::PhysicalDevice,
    ) -> PhysicalDevice {
        unsafe {
            let instance = &instance.inner;
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
    pub fn create_physical_devices(instance: &Arc<Instance>) -> Result<PhysicalDevices> {
        unsafe {
            let devices = instance
                .inner
                .enumerate_physical_devices()?
                .into_iter()
                .map(|d| Self::create_physical_device(instance, d))
                .collect();

            Ok(PhysicalDevices {
                inner: devices,
                features: vec![],
            })
        }
    }
}

pub struct PhysicalDevices {
    pub inner: Vec<PhysicalDevice>,
    pub features: Vec<Box<dyn vk::ExtendsPhysicalDeviceFeatures2>>,
}

impl PhysicalDevices {
    pub fn new(devices: &[PhysicalDevice]) -> Self {
        Self {
            inner: devices.to_vec(),
            features: Vec::new(),
        }
    }
    pub fn for_surface(mut self, surface: &Surface) -> Self {
        self.inner = self
            .inner
            .into_iter()
            .filter(|qf| qf.supports_surface(surface))
            .collect();
        self
    }

    pub fn with_features<T>(self, _features: &[T]) -> Self {
        todo!()
    }

    pub fn select(self, f: fn(&PhysicalDevice) -> i32) -> Result<Arc<PhysicalDevice>> {
        let selected = self.inner.into_iter().rev().max_by_key(|d| f(d));
        match selected {
            Some(device) => Ok(Arc::new(device)),
            None => Err(anyhow!("Could not find suitable physical device")),
        }
    }

    pub fn select_default(self) -> Result<Arc<PhysicalDevice>> {
        self.select(|device| match device.properties.device_type {
            vk::PhysicalDeviceType::INTEGRATED_GPU => 200,
            vk::PhysicalDeviceType::DISCRETE_GPU => 1000,
            vk::PhysicalDeviceType::VIRTUAL_GPU => 1,
            _ => 0,
        })
    }
}
