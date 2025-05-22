use {
    crate::{CommandBuffer, CommandPool, Instance, TIMEOUT_NS},
    anyhow::{anyhow, Result},
    ash::{
        ext, khr,
        vk::{self, BufferDeviceAddressInfo, Handle, PhysicalDeviceProperties, LOD_CLAMP_NONE},
    },
    derive_more::{Debug, Deref},
    std::{ffi, slice},
};

const DEVICE_EXTENSIONS: [&ffi::CStr; 10] = [
    khr::maintenance1::NAME,
    khr::maintenance2::NAME,
    khr::maintenance3::NAME,
    khr::swapchain::NAME,
    khr::synchronization2::NAME,
    khr::dynamic_rendering::NAME,
    ext::descriptor_indexing::NAME,
    khr::buffer_device_address::NAME,
    khr::push_descriptor::NAME,
    khr::shader_non_semantic_info::NAME,
];

#[allow(dead_code)]
#[derive(Clone, Copy, Debug)]
pub struct QueueFamily {
    pub(crate) index: u32,
    pub(crate) properties: vk::QueueFamilyProperties,
}

impl QueueFamily {
    pub fn index(&self) -> u32 { self.index }
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Deref)]
pub struct Queue {
    #[deref]
    #[debug("{:#x}", handle.as_raw())]
    pub(crate) handle: vk::Queue,
    #[debug("{:?}", family.index)]
    pub(crate) family: QueueFamily,
}
impl Queue {
    pub fn handle(&self) -> vk::Queue { self.handle }
    pub fn family(&self) -> QueueFamily { self.family }
}

#[derive(Clone, Debug, Deref)]
pub struct Device {
    #[deref]
    #[debug("{:#x}", handle.handle().as_raw())]
    pub(crate) handle: ash::Device, // TODO
    pub(crate) gfx_queue: Queue,
    pub(crate) transfer_queue: Queue,
    pub(crate) physical_device: vk::PhysicalDevice,
    properties: PhysicalDeviceProperties,
}

impl Device {
    pub fn new(instance: &Instance) -> Result<Device> {
        let candidate_devices = instance.enumerate_physical_devices()?;

        let selected = candidate_devices
            .into_iter()
            .rev()
            .max_by_key(|d| Self::rank_physical_device(instance, d));

        let physical_device =
            selected.ok_or_else(|| anyhow!("No suitable physical device found"))?;
        let (graphics_queue_family, transfer_queue_family) =
            Self::init_queue_families(instance, &physical_device)?;

        let device_extension_names: Vec<*const i8> = DEVICE_EXTENSIONS
            .iter()
            .map(|n| n.as_ptr())
            .collect::<Vec<_>>();
        let mut device_fault_features =
            ash::vk::PhysicalDeviceFaultFeaturesEXT::default().device_fault(true);
        let mut swapchain_maintenance_features =
            ash::vk::PhysicalDeviceSwapchainMaintenance1FeaturesEXT::default()
                .swapchain_maintenance1(true);
        let mut timeline_semaphore_features =
            ash::vk::PhysicalDeviceTimelineSemaphoreFeaturesKHR::default().timeline_semaphore(true);
        let mut synchronization2_features =
            ash::vk::PhysicalDeviceSynchronization2FeaturesKHR::default().synchronization2(true);
        let mut dynamic_rendering_features =
            ash::vk::PhysicalDeviceDynamicRenderingFeaturesKHR::default().dynamic_rendering(true);
        let mut buffer_device_address_features =
            ash::vk::PhysicalDeviceBufferDeviceAddressFeaturesKHR::default()
                .buffer_device_address(true);
        let mut device_address_binding_report_features =
            ash::vk::PhysicalDeviceAddressBindingReportFeaturesEXT::default()
                .report_address_binding(true);
        let mut descriptor_indexing_features =
            ash::vk::PhysicalDeviceDescriptorIndexingFeaturesEXT::default()
                .shader_sampled_image_array_non_uniform_indexing(true)
                .descriptor_binding_uniform_buffer_update_after_bind(true)
                .descriptor_binding_sampled_image_update_after_bind(true)
                .descriptor_binding_partially_bound(true)
                .descriptor_binding_variable_descriptor_count(true)
                .descriptor_binding_update_unused_while_pending(true)
                .runtime_descriptor_array(true);

        let mut device_8bit_storage_features =
            ash::vk::PhysicalDevice8BitStorageFeaturesKHR::default()
                .storage_buffer8_bit_access(true);
        let mut device_coherent_memory_features =
            ash::vk::PhysicalDeviceCoherentMemoryFeaturesAMD::default()
                .device_coherent_memory(true);

        let device_features1 = vk::PhysicalDeviceFeatures::default()
            .geometry_shader(true)
            .wide_lines(true);
        let mut device_features2 = vk::PhysicalDeviceFeatures2::default()
            .features(device_features1)
            .push_next(&mut timeline_semaphore_features)
            .push_next(&mut swapchain_maintenance_features)
            .push_next(&mut synchronization2_features)
            .push_next(&mut dynamic_rendering_features)
            .push_next(&mut buffer_device_address_features)
            .push_next(&mut device_8bit_storage_features)
            .push_next(&mut descriptor_indexing_features)
            .push_next(&mut device_fault_features)
            .push_next(&mut device_coherent_memory_features)
            .push_next(&mut device_address_binding_report_features);

        let queue_families = [graphics_queue_family, transfer_queue_family];
        let handle = instance.create_device(
            physical_device,
            queue_families,
            &device_extension_names,
            &mut device_features2,
        )?;
        let graphics_queue = Self::create_queue(&handle, graphics_queue_family);
        let transfer_queue = Self::create_queue(&handle, transfer_queue_family);
        let properties = instance.get_physical_device_properties(physical_device);

        Ok(Device {
            handle,
            physical_device,
            gfx_queue: graphics_queue,
            transfer_queue,
            properties,
        })
    }

    pub fn handle(&self) -> &ash::Device { &self.handle }

    pub fn physical_device(&self) -> vk::PhysicalDevice { self.physical_device }

    pub fn graphics_queue(&self) -> &Queue { &self.gfx_queue }

    pub fn transfer_queue(&self) -> &Queue { &self.transfer_queue }

    pub fn properties(&self) -> &PhysicalDeviceProperties { &self.properties }
}

impl Device {
    fn rank_physical_device(instance: &Instance, physical_device: &vk::PhysicalDevice) -> i32 {
        let device_properties = instance.get_physical_device_properties(*physical_device);
        let queue_families = instance.get_physical_device_queue_family_properties(*physical_device);

        // TODO extension checks

        let mut score = match queue_families
            .into_iter()
            .find(|qf| qf.queue_flags.contains(vk::QueueFlags::GRAPHICS))
        {
            Some(_) => 10000,
            None => 0,
        };

        score += match device_properties.device_type {
            vk::PhysicalDeviceType::INTEGRATED_GPU => 20,
            vk::PhysicalDeviceType::DISCRETE_GPU => 100,
            vk::PhysicalDeviceType::VIRTUAL_GPU => 1,
            _ => 0,
        };

        score
    }

    fn rank_graphics_queue_family(queue_family: vk::QueueFamilyProperties) -> i32 {
        let mut score = 100;
        if queue_family.queue_flags.contains(vk::QueueFlags::COMPUTE) {
            score -= 10;
        }
        if queue_family
            .queue_flags
            .contains(vk::QueueFlags::SPARSE_BINDING)
        {
            score -= 1;
        }
        score
    }

    fn rank_transfer_queue_family(queue_family: vk::QueueFamilyProperties) -> i32 {
        let mut score = 100;
        if queue_family.queue_flags.contains(vk::QueueFlags::GRAPHICS) {
            score -= 20;
        }
        if queue_family.queue_flags.contains(vk::QueueFlags::COMPUTE) {
            score -= 10;
        }
        if queue_family
            .queue_flags
            .contains(vk::QueueFlags::SPARSE_BINDING)
        {
            score -= 1;
        }
        score
    }

    fn init_queue_families(
        instance: &Instance,
        physical_device: &vk::PhysicalDevice,
    ) -> Result<(QueueFamily, QueueFamily)> {
        let families = instance.get_physical_device_queue_family_properties(*physical_device);

        let graphics_fam = families
            .iter()
            .enumerate()
            .filter(|(_, qf)| qf.queue_flags.contains(vk::QueueFlags::GRAPHICS))
            .max_by_key(|(i, qf)| {
                let score = Self::rank_graphics_queue_family(**qf);
                log::debug!(
                    "Candidate queue family for graphics: {} ({:?} {}) -> score: {}",
                    i,
                    qf.queue_flags,
                    qf.queue_count,
                    score
                );
                score
            })
            .ok_or_else(|| anyhow!("No suitable graphics queue family found"))?;

        let transfer_fam = families
            .iter()
            .enumerate()
            .filter(|(_, qf)| qf.queue_flags.contains(vk::QueueFlags::TRANSFER))
            .max_by_key(|(i, qf)| {
                let score = Self::rank_transfer_queue_family(**qf);
                log::debug!(
                    "Candidate queue family for transfer: {} ({:?} {}) -> score: {}",
                    i,
                    qf.queue_flags,
                    qf.queue_count,
                    score
                );
                score
            })
            .ok_or_else(|| anyhow!("No suitable transfer queue family found"))?;

        log::info!("Selected graphics queue family index: {}", graphics_fam.0);
        log::info!("Selected transfer queue family index: {}", transfer_fam.0);

        Ok((
            QueueFamily {
                index: graphics_fam.0 as u32,
                properties: *graphics_fam.1,
            },
            QueueFamily {
                index: transfer_fam.0 as u32,
                properties: *transfer_fam.1,
            },
        ))
    }
}

impl Device {
    pub fn wait_idle(&self) {
        unsafe {
            self.handle
                .device_wait_idle()
                .unwrap_or_else(|e| panic!("Error idling device:: {e}"));
        }
    }
    fn create_queue(handle: &ash::Device, family: QueueFamily) -> Queue {
        let handle = unsafe { handle.get_device_queue(family.index, 0) };
        Queue { handle, family }
    }

    pub fn create_fence(&self, flags: vk::FenceCreateFlags) -> vk::Fence {
        let info = vk::FenceCreateInfo::default().flags(flags);
        let fence = unsafe {
            self.handle
                .create_fence(&info, None)
                .unwrap_or_else(|e| panic!("Error creating fence: {e}"))
        };

        log::trace!("Created fence {fence:?}");
        fence
    }

    pub fn create_timeline_semaphore(&self, initial_value: u64) -> vk::Semaphore {
        let mut semaphore_type_create_info = vk::SemaphoreTypeCreateInfo::default()
            .semaphore_type(vk::SemaphoreType::TIMELINE)
            .initial_value(initial_value);

        let create_info =
            vk::SemaphoreCreateInfo::default().push_next(&mut semaphore_type_create_info);

        unsafe {
            self.handle
                .create_semaphore(&create_info, None)
                .unwrap_or_else(|e| panic!("Error creating timeline semaphore: {e:?}"))
        }
    }

    pub fn wait_for_timeline_semaphores(&self, semaphores: &[(vk::Semaphore, u64)]) -> Result<()> {
        let values = semaphores.iter().map(|(_, v)| *v).collect::<Vec<_>>();
        let semaphores = semaphores.iter().map(|(s, _)| *s).collect::<Vec<_>>();
        let info = vk::SemaphoreWaitInfo::default()
            .semaphores(semaphores.as_slice())
            .values(values.as_slice());

        unsafe {
            self.handle.wait_semaphores(&info, u64::MAX)?;
        }

        Ok(())
    }

    pub fn create_semaphore(&self) -> vk::Semaphore {
        let semaphore = unsafe {
            self.handle
                .create_semaphore(&vk::SemaphoreCreateInfo::default(), None)
                .unwrap_or_else(|e| panic!("Error creating semaphore: {e:?}"))
        };

        log::trace!("Created semaphore: {semaphore:?}");
        semaphore
    }

    pub fn create_command_pool(&self, queue: &Queue, _name: &str) -> CommandPool {
        let info = vk::CommandPoolCreateInfo::default()
            .flags(vk::CommandPoolCreateFlags::RESET_COMMAND_BUFFER)
            .queue_family_index(queue.family.index);
        let handle = unsafe {
            self.handle
                .create_command_pool(&info, None)
                .unwrap_or_else(|e| {
                    panic!(
                        "Error creating command pool for queue {}: {e:?}",
                        queue.family.index
                    )
                })
        };
        CommandPool {
            // name: name.to_string(),
            // queue: *queue,
            handle,
            device: self.clone(),
        }
    }
    pub fn create_command_buffer(&self, pool: &CommandPool) -> vk::CommandBuffer {
        let info = vk::CommandBufferAllocateInfo::default()
            .command_buffer_count(1)
            .command_pool(pool.handle)
            .level(vk::CommandBufferLevel::PRIMARY);

        unsafe {
            self.handle
                .allocate_command_buffers(&info)
                .unwrap_or_else(|e| panic!("Error creating command buffer: {e:?}"))[0]
        }
    }

    pub fn create_sampler(
        &self,
        min_filter: vk::Filter,
        mag_filter: vk::Filter,
        mipmap_mode: vk::SamplerMipmapMode,
        address_mode_u: vk::SamplerAddressMode,
        address_mode_v: vk::SamplerAddressMode,
    ) -> Result<vk::Sampler> {
        let info = vk::SamplerCreateInfo::default()
            .mag_filter(mag_filter)
            .min_filter(min_filter)
            .min_lod(0.)
            .max_lod(LOD_CLAMP_NONE)
            .mipmap_mode(mipmap_mode)
            .address_mode_u(address_mode_u)
            .address_mode_v(address_mode_v);
        Ok(unsafe { self.handle.create_sampler(&info, None)? })
    }

    pub fn pipeline_barrier(
        &self,
        cmd: &CommandBuffer,
        memory_barriers: &[vk::MemoryBarrier2],
        buffer_memory_barriers: &[vk::BufferMemoryBarrier2],
        image_memory_barriers: &[vk::ImageMemoryBarrier2],
    ) -> Result<()> {
        let dependency_info = vk::DependencyInfo::default()
            .memory_barriers(memory_barriers)
            .image_memory_barriers(image_memory_barriers)
            .buffer_memory_barriers(buffer_memory_barriers)
            .dependency_flags(vk::DependencyFlags::BY_REGION);
        unsafe {
            self.handle
                .cmd_pipeline_barrier2(cmd.handle, &dependency_info)
        };
        Ok(())
    }

    pub fn update_descriptor_sets(
        &self,
        writes: &[vk::WriteDescriptorSet],
        copies: &[vk::CopyDescriptorSet],
    ) -> Result<()> {
        unsafe {
            self.handle.update_descriptor_sets(writes, copies);
        }
        Ok(())
    }

    pub fn get_buffer_device_address(&self, buffer: &vk::Buffer) -> vk::DeviceAddress {
        unsafe {
            self.handle
                .get_buffer_device_address(&BufferDeviceAddressInfo::default().buffer(*buffer))
        }
    }

    pub fn flush_mapped_memory_ranges(&self, ranges: &[vk::MappedMemoryRange]) {
        unsafe {
            self.handle
                .flush_mapped_memory_ranges(ranges)
                .unwrap_or_else(|e| panic!("Error flushing mapped memory ranges: {e:?}"))
        }
    }

    pub fn wait_for_fences(&self, fences: &[vk::Fence]) {
        log::trace!("Waiting for fences: {:?}", fences);
        unsafe {
            self.handle
                .wait_for_fences(fences, true, TIMEOUT_NS)
                .unwrap_or_else(|e| panic!("Timeout waiting for fences {fences:?}: {e}"))
        }
    }

    pub fn reset_fences(&self, fences: &[vk::Fence]) {
        log::trace!("Resetting fences: {:?}", fences);
        unsafe {
            self.handle
                .reset_fences(fences)
                .unwrap_or_else(|e| panic!("Error resetting fences: {fences:?}: {e}"))
        }
    }

    pub fn queue_submit(
        &self,
        queue: &Queue,
        command_buffers: &[vk::CommandBuffer],
        wait_semaphores: &[(vk::Semaphore, vk::PipelineStageFlags2)],
        signal_semaphores: &[(vk::Semaphore, vk::PipelineStageFlags2)],
        fence: vk::Fence,
    ) {
        log::trace!(
            "Submitting {:?} to {:?}, wait_semaphores: {:?}, signal_semaphores: {:?}, fence: {:?}",
            command_buffers,
            queue,
            wait_semaphores,
            signal_semaphores,
            fence
        );
        let cmd_infos = command_buffers
            .iter()
            .map(|cb| vk::CommandBufferSubmitInfo::default().command_buffer(*cb))
            .collect::<Vec<_>>();
        let wait_semaphore_infos = wait_semaphores
            .iter()
            .map(|(s, f)| {
                vk::SemaphoreSubmitInfo::default()
                    .semaphore(*s)
                    .stage_mask(*f)
            })
            .collect::<Vec<_>>();
        let signal_semaphore_infos = signal_semaphores
            .iter()
            .map(|(s, f)| {
                vk::SemaphoreSubmitInfo::default()
                    .semaphore(*s)
                    .stage_mask(*f)
            })
            .collect::<Vec<_>>();
        let submit_info = vk::SubmitInfo2::default()
            .command_buffer_infos(&cmd_infos)
            .wait_semaphore_infos(&wait_semaphore_infos)
            .signal_semaphore_infos(&signal_semaphore_infos);
        unsafe {
            self.handle
                .queue_submit2(**queue, slice::from_ref(&submit_info), fence)
                .unwrap_or_else(|e| {
                    panic!("Error submitting command buffer ({self:?}) to queue: {e}")
                })
        }
    }
}
