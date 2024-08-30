use crate::gfx::instance::Instance;
use anyhow::Result;
use ash::vk::Handle;
use ash::{khr, vk};
use raw_window_handle::HasDisplayHandle;
use raw_window_handle::HasWindowHandle;
use std::fmt;
use std::sync::Arc;
use winit::window::Window;
pub struct Surface {
    pub inner: vk::SurfaceKHR,
    pub fns: khr::surface::Instance,
}

impl fmt::Debug for Surface {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Surface")
            .field("raw", &self.inner.as_raw())
            .field("fns", &self.fns.instance())
            .finish()
    }
}

impl Surface {
    pub fn create(instance: Arc<Instance>, window: Arc<Window>) -> Result<Arc<Self>> {
        let surface = unsafe {
            ash_window::create_surface(
                &instance.entry,
                &instance.raw,
                window.display_handle()?.into(),
                window.window_handle()?.into(),
                None,
            )
            .unwrap()
        };
        let surface_loader = khr::surface::Instance::new(&instance.entry, &instance.raw); // khr::Surface::new(&instance.entry, &instance.raw);

        Ok(Arc::new(Self {
            inner: surface,
            fns: surface_loader,
        }))
    }
}
