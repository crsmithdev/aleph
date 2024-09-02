use crate::gfx::vk::instance::Instance;
use anyhow::Result;
use ash::{khr, vk, vk::Handle};
use raw_window_handle::{HasDisplayHandle, HasWindowHandle};
use std::{fmt, sync::Arc};
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
            .finish_non_exhaustive()
    }
}

impl Surface {
    pub fn create(instance: Arc<Instance>, window: Arc<Window>) -> Result<Arc<Self>> {
        let surface = unsafe {
            ash_window::create_surface(
                &instance.entry,
                &instance.inner,
                window.display_handle()?.into(),
                window.window_handle()?.into(),
                None,
            )
            .unwrap()
        };
        let surface_loader = khr::surface::Instance::new(&instance.entry, &instance.inner); // khr::Surface::new(&instance.entry, &instance.raw);

        Ok(Arc::new(Self {
            inner: surface,
            fns: surface_loader,
        }))
    }
}
