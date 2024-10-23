use {
    crate::vk::{instance::Instance, render_backend::RenderBackend},
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
    pub loader: khr::surface::Instance,
}

impl fmt::Debug for Surface {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Surface")
            .field("inner", &self.inner.as_raw())
            .field("loader", &self.loader.instance())
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
        let surface_loader = khr::surface::Instance::new(&instance.entry, &instance.inner);

        Ok(Arc::new(Surface {
            inner: surface,
            loader: surface_loader,
        }))
    }
}
