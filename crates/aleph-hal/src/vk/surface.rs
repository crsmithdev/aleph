// use {
//     crate::vk::instance::Instance,
//     anyhow::Result,
//     ash::{
//         khr,
//         vk::{self, Handle},
//     },
//     raw_window_handle::{HasDisplayHandle, HasWindowHandle},
//     std::{fmt, sync::Arc},
//     winit::window::Window,
// };
// pub struct Surface {
//     pub inner: vk::SurfaceKHR,
//     pub loader: khr::surface::Instance,
// }

// impl fmt::Debug for Surface {
//     fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
//         f.debug_struct("Surface")
//             .field("inner", &self.inner.as_raw())
//             .field("loader", &self.loader.instance())
//             .finish_non_exhaustive()
//     }
// }

// pub struct SurfaceInfo<'a> {
//     pub window: &'a Arc<Window>,
//     pub instance: &'a Arc<Instance>,
// }

// impl Surface {
//     pub fn new(info: &SurfaceInfo) -> Result<Surface> {
//         let surface = unsafe {
//             ash_window::create_surface(
//                 &info.instance.entry,
//                 &info.instance.inner,
//                 info.window.display_handle()?.into(),
//                 info.window.window_handle()?.into(),
//                 None,
//             )
//             .unwrap()
//         };
//         let surface_loader =
//             khr::surface::Instance::new(&info.instance.entry, &info.instance.inner);

//         Ok(Surface {
//             inner: surface,
//             loader: surface_loader,
//         })
//     }
// }
