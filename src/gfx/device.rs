use crate::{gfx::physical_device::{PhysicalDevice, PhysicalDevices, QueueFamily}, prelude::Instance};
use anyhow::Result;
use ash::{khr, vk};
// use gpu_allocator::{AllocatorDebugSettings, VulkanAllocator, VulkanAllocatorCreateDesc};
// use gpu_profiler::backend::ash::VulkanProfilerFrame;
// dse parking_lot::Mutex;
use std::{
    collections::HashSet,
    os::raw::c_char,
    sync::Arc,
};
pub struct Queue {
    pub raw: vk::Queue,
    pub family: QueueFamily,
}

pub struct Device {
    pub raw: ash::Device,
    pub(crate) pdevice: Arc<PhysicalDevice>,
    pub universal_queue: Queue,
}

impl Device {
    pub fn create(instance: Arc<Instance>, physical_device: Arc<PhysicalDevice>) -> Result<Arc<Self>> {
        let supported_extensions: HashSet<String> = unsafe {
            let extension_properties =
                instance
                .raw
                .enumerate_device_extension_properties(physical_device.inner)?;
            log::debug!("Extension properties:\n{:#?}", &extension_properties);

            extension_properties
                .iter()
                .map(|ext| {
                    std::ffi::CStr::from_ptr(ext.extension_name.as_ptr() as *const c_char)
                        .to_string_lossy()
                        .as_ref()
                        .to_owned()
                })
                .collect()
        };

        let mut device_extension_names = vec![];

        // let ray_tracing_extensions = [
        // ];

        // let ray_tracing_enabled = false;
        //     ray_tracing_extensions.iter().all(|ext| {
        //         let ext = std::ffi::CStr::from_ptr(*ext).to_string_lossy();

        //         let supported = supported_extensions.contains(ext.as_ref());

        //         if !supported {
        //             log::info!("Ray tracing extension not supported: {}", ext);
        //         }

        //         supported
        //     })
        // };

        // if ray_tracing_enabled {
        //     log::info!("All ray tracing extensions are supported");

        //     device_extension_names.extend(ray_tracing_extensions.iter());
        // }

        // if physical_device.presentation_requested {
        device_extension_names.push(ash::khr::swapchain::NAME.as_ptr());
        device_extension_names.push(ash::khr::swapchain::NAME.as_ptr());
        // }

        // unsafe {
        //     for &ext in &device_extension_names {
        //         let ext = std::ffi::CStr::from_ptr(ext).to_string_lossy();
        //         if !supported_extensions.contains(ext.as_ref()) {
        //             panic!("Device extension not supported: {}", ext);
        //         }
        //     }
        // }

        let priorities = [1.0];

        let universal_queue = physical_device
            .queue_families
            .iter()
            .filter(|qf| qf.properties.queue_flags.contains(vk::QueueFlags::GRAPHICS))
            .copied()
            .next()
            .unwrap();

        // let universal_queue = if let Some(universal_queue) = universal_queue {
        //     universal_queue
        // } else {
        //     anyhow::bail!("No suitable render queue found");
        // };

        let universal_queue_info = [vk::DeviceQueueCreateInfo::default()
            .queue_family_index(universal_queue.index)
            .queue_priorities(&priorities)];

        let mut features2 = vk::PhysicalDeviceFeatures2::default();

        let device_create_info = vk::DeviceCreateInfo::default()
            .queue_create_infos(&universal_queue_info)
            .enabled_extension_names(&device_extension_names)
            .push_next(&mut features2);
        // .build();

        let device = unsafe {
                 instance
                .raw
                .create_device(physical_device.inner, &device_create_info, None)
                .unwrap()
        };

        log::info!("Created a Vulkan device");

        // let mut global_allocator = VulkanAllocator::new(&VulkanAllocatorCreateDesc {
        //     instance: instance.clone(),
        //     device: device.clone(),
        //     physical_device: physical_device.inner,
        // debug_settings: AllocatorDebugSettings {
        // log_leaks_on_shutdown: false,
        // log_memory_information: true,
        // log_allocations: true,
        // ..Default::default()
        // },
        // buffer_device_address: true,
        // });

        let universal_queue = Queue {
            raw: unsafe { device.get_device_queue(universal_queue.index, 0) },
            family: universal_queue,
        };

        // let frame0 = DeviceFrame::new(
        //     physical_device,
        //     &device,
        //     &mut global_allocator,
        //     &universal_queue.family,
        // );
        // let frame1 = DeviceFrame::new(
        //     physical_device,
        //     &device,
        //     &mut global_allocator,
        //     &universal_queue.family,
        // );
        //let frame2 = DeviceFrame::new(&device, &mut global_allocator, &universal_queue.family);

        // let immutable_samplers = Self::create_samplers(&device);
        // let setup_cb = CommandBuffer::new(&device, &universal_queue.family).unwrap();

        // let acceleration_structure_ext =
        //     khr::AccelerationStructure::new(&physical_device.instance.inner, &device);
        // let ray_tracing_pipeline_ext =
        //     khr::RayTracingPipeline::new(&physical_device.instance.inner, &device);
        // //let ray_query_ext = khr::RayQuery::new(&physical_device.instance.inner, &device);
        // let ray_tracing_pipeline_properties =
        //     khr::RayTracingPipeline::get_properties(&physical_device.instance.inner,
        // pdevice.inner);

        // let crash_tracking_buffer = Self::create_buffer_impl(
        //     &device,
        //     &mut global_allocator,
        //     BufferDesc::new_gpu_to_cpu(4, vk::BufferUsageFlags::TRANSFER_DST),
        //     "crash tracking buffer",
        // )?;

        Ok(Arc::new(Device {
            pdevice: physical_device.clone(),
            raw: device,
            universal_queue,
            // global_allocator: Arc::new(Mutex::new(global_allocator)),
            // immutable_samplers,
            // setup_cb: Mutex::new(setup_cb),
            // crash_tracking_buffer,
            // crash_marker_names: Default::default(),
            // acceleration_structure_ext,
            // ray_tracing_pipeline_ext,
            // // ray_query_ext,
            // ray_tracing_pipeline_properties,
            // frames: [
            //     Mutex::new(Arc::new(frame0)),
            //     Mutex::new(Arc::new(frame1)),
            //     //Mutex::new(Arc::new(frame2)),
            // ],
            // ray_tracing_enabled,
        }))
    }
}
