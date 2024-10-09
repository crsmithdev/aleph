use {
    super::RenderBackend,
    crate::vk::instance::Instance,
    anyhow::Result,
    ash::{
        khr,
        vk::{self, Handle},
    },
    raw_window_handle::{HasDisplayHandle, HasWindowHandle},
    std::{fmt, sync::Arc},
    winit::window::Window,
};
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

impl RenderBackend {
    pub fn create_surface(instance: Arc<Instance>, window: Arc<Window>) -> Result<Arc<Surface>> {
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

        Ok(Arc::new(Surface {
            inner: surface,
            fns: surface_loader,
        }))
    }
}
