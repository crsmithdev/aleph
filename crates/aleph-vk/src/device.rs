use {
    crate::{CommandBuffer, Instance, TIMEOUT_NS},
    anyhow::{anyhow, Result},
    ash::{
        ext, khr,
        vk::{
            Buffer as VkBuffer, BufferDeviceAddressInfo, BufferMemoryBarrier2,
            CommandBuffer as VkCommandBuffer, CommandBufferAllocateInfo, CommandBufferLevel,
            CommandBufferSubmitInfo, CommandPool as VkCommandPool, CommandPoolCreateFlags,
            CommandPoolCreateInfo, CopyDescriptorSet, DependencyFlags, DependencyInfo,
            DescriptorBindingFlags, DescriptorPool, DescriptorPoolCreateFlags,
            DescriptorPoolCreateInfo, DescriptorPoolSize, DescriptorSet, DescriptorSetAllocateInfo,
            DescriptorSetLayout, DescriptorSetLayoutBinding,
            DescriptorSetLayoutBindingFlagsCreateInfo, DescriptorSetLayoutCreateFlags,
            DescriptorSetLayoutCreateInfo, DescriptorSetVariableDescriptorCountAllocateInfo,
            DeviceAddress, Fence, FenceCreateFlags,
            FenceCreateInfo, Filter, GraphicsPipelineCreateInfo, Handle, ImageMemoryBarrier2,
            MappedMemoryRange, MemoryBarrier2, PhysicalDevice,
            PhysicalDevice8BitStorageFeaturesKHR, PhysicalDeviceBufferDeviceAddressFeaturesKHR,
            PhysicalDeviceDescriptorIndexingFeaturesEXT, PhysicalDeviceDynamicRenderingFeaturesKHR,
            PhysicalDeviceFeatures, PhysicalDeviceFeatures2, PhysicalDeviceProperties,
            PhysicalDeviceRobustness2FeaturesEXT, PhysicalDeviceSwapchainMaintenance1FeaturesEXT,
            PhysicalDeviceSynchronization2FeaturesKHR, PhysicalDeviceTimelineSemaphoreFeaturesKHR,
            PhysicalDeviceType, Pipeline, PipelineCache, PipelineLayout, PipelineLayoutCreateInfo,
            PushConstantRange, Queue as VkQueue, QueueFamilyProperties, QueueFlags,
            Sampler as VkSampler, SamplerAddressMode, SamplerCreateInfo, SamplerMipmapMode,
            Semaphore, SemaphoreCreateInfo, SemaphoreSubmitInfo, SemaphoreType,
            SemaphoreTypeCreateInfo, SemaphoreWaitInfo, ShaderModule, ShaderModuleCreateInfo,
            SubmitInfo2, WriteDescriptorSet, LOD_CLAMP_NONE,
        },
        Device as AshDevice,
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
    pub(crate) properties: QueueFamilyProperties,
}

impl QueueFamily {
    pub fn index(&self) -> u32 { self.index }
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Deref)]
pub struct Queue {
    #[deref]
    #[debug("{:#x}", handle.as_raw())]
    pub(crate) handle: VkQueue,
    #[debug("{:?}", family.index)]
    pub(crate) family: QueueFamily,
}
impl Queue {
    pub fn handle(&self) -> VkQueue { self.handle }
    pub fn family(&self) -> QueueFamily { self.family }
}

#[derive(Clone, Debug, Deref)]
pub struct Device {
    #[deref]
    #[debug("{:#x}", handle.handle().as_raw())]
    pub(crate) handle: AshDevice, // TODO
    pub(crate) gfx_queue: Queue,
    pub(crate) transfer_queue: Queue,
    pub(crate) physical_device: PhysicalDevice,
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
        let queue_families = [graphics_queue_family, transfer_queue_family];

        let mut swapchain_maintenance_features =
            PhysicalDeviceSwapchainMaintenance1FeaturesEXT::default().swapchain_maintenance1(true);
        let mut timeline_semaphore_features =
            PhysicalDeviceTimelineSemaphoreFeaturesKHR::default().timeline_semaphore(true);
        let mut synchronization2_features =
            PhysicalDeviceSynchronization2FeaturesKHR::default().synchronization2(true);
        let mut dynamic_rendering_features =
            PhysicalDeviceDynamicRenderingFeaturesKHR::default().dynamic_rendering(true);
        let mut buffer_device_address_features =
            PhysicalDeviceBufferDeviceAddressFeaturesKHR::default().buffer_device_address(true);
        let mut descriptor_indexing_features =
            PhysicalDeviceDescriptorIndexingFeaturesEXT::default()
                .shader_sampled_image_array_non_uniform_indexing(true)
                .descriptor_binding_uniform_buffer_update_after_bind(true)
                .descriptor_binding_sampled_image_update_after_bind(true)
                .descriptor_binding_partially_bound(true)
                .descriptor_binding_variable_descriptor_count(true)
                .descriptor_binding_update_unused_while_pending(true)
                .runtime_descriptor_array(true);
        let mut device_8bit_storage_features =
            PhysicalDevice8BitStorageFeaturesKHR::default().storage_buffer8_bit_access(true);
        let mut device_robustness2_features = PhysicalDeviceRobustness2FeaturesEXT::default()
            .robust_buffer_access2(true)
            .robust_image_access2(true);
        let features1 = PhysicalDeviceFeatures::default().robust_buffer_access(true);
        let mut features2 = PhysicalDeviceFeatures2::default()
            .features(features1)
            .push_next(&mut timeline_semaphore_features)
            .push_next(&mut swapchain_maintenance_features)
            .push_next(&mut synchronization2_features)
            .push_next(&mut dynamic_rendering_features)
            .push_next(&mut buffer_device_address_features)
            .push_next(&mut device_8bit_storage_features)
            .push_next(&mut descriptor_indexing_features)
            .push_next(&mut device_robustness2_features);
        let extensions: Vec<*const i8> =
            DEVICE_EXTENSIONS.iter().map(|n| n.as_ptr()).collect::<Vec<_>>();

        let handle =
            instance.create_device(physical_device, queue_families, &extensions, &mut features2)?;
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

    pub fn handle(&self) -> &AshDevice { &self.handle }

    pub fn physical_device(&self) -> PhysicalDevice { self.physical_device }

    pub fn graphics_queue(&self) -> &Queue { &self.gfx_queue }

    pub fn transfer_queue(&self) -> &Queue { &self.transfer_queue }

    pub fn properties(&self) -> &PhysicalDeviceProperties { &self.properties }
}

impl Device {
    fn rank_physical_device(instance: &Instance, physical_device: &PhysicalDevice) -> i32 {
        let device_properties = instance.get_physical_device_properties(*physical_device);
        let queue_families = instance.get_physical_device_queue_family_properties(*physical_device);

        // TODO extension checks

        let mut score = match queue_families
            .into_iter()
            .find(|qf| qf.queue_flags.contains(QueueFlags::GRAPHICS))
        {
            Some(_) => 10000,
            None => 0,
        };

        score += match device_properties.device_type {
            PhysicalDeviceType::INTEGRATED_GPU => 20,
            PhysicalDeviceType::DISCRETE_GPU => 100,
            PhysicalDeviceType::VIRTUAL_GPU => 1,
            _ => 0,
        };

        score
    }

    fn rank_graphics_queue_family(queue_family: QueueFamilyProperties) -> i32 {
        let mut score = 100;
        if queue_family.queue_flags.contains(QueueFlags::COMPUTE) {
            score -= 10;
        }
        if queue_family.queue_flags.contains(QueueFlags::SPARSE_BINDING) {
            score -= 1;
        }
        score
    }

    fn rank_transfer_queue_family(queue_family: QueueFamilyProperties) -> i32 {
        let mut score = 100;
        if queue_family.queue_flags.contains(QueueFlags::GRAPHICS) {
            score -= 20;
        }
        if queue_family.queue_flags.contains(QueueFlags::COMPUTE) {
            score -= 10;
        }
        if queue_family.queue_flags.contains(QueueFlags::SPARSE_BINDING) {
            score -= 1;
        }
        score
    }

    fn init_queue_families(
        instance: &Instance,
        physical_device: &PhysicalDevice,
    ) -> Result<(QueueFamily, QueueFamily)> {
        let families = instance.get_physical_device_queue_family_properties(*physical_device);

        let graphics_fam = families
            .iter()
            .enumerate()
            .filter(|(_, qf)| qf.queue_flags.contains(QueueFlags::GRAPHICS))
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
            .filter(|(_, qf)| qf.queue_flags.contains(QueueFlags::TRANSFER))
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
    fn create_queue(handle: &AshDevice, family: QueueFamily) -> Queue {
        let handle = unsafe { handle.get_device_queue(family.index, 0) };
        Queue { handle, family }
    }

    pub fn create_fence(&self, flags: FenceCreateFlags) -> Fence {
        let info = FenceCreateInfo::default().flags(flags);
        let fence = unsafe {
            self.handle
                .create_fence(&info, None)
                .unwrap_or_else(|e| panic!("Error creating fence: {e}"))
        };

        log::trace!("Created fence {fence:?}");
        fence
    }

    pub fn create_timeline_semaphore(&self, initial_value: u64) -> Semaphore {
        let mut semaphore_type_create_info = SemaphoreTypeCreateInfo::default()
            .semaphore_type(SemaphoreType::TIMELINE)
            .initial_value(initial_value);

        let create_info = SemaphoreCreateInfo::default().push_next(&mut semaphore_type_create_info);

        unsafe {
            self.handle
                .create_semaphore(&create_info, None)
                .unwrap_or_else(|e| panic!("Error creating timeline semaphore: {e:?}"))
        }
    }

    pub fn wait_for_timeline_semaphores(&self, semaphores: &[(Semaphore, u64)]) -> Result<()> {
        let values = semaphores.iter().map(|(_, v)| *v).collect::<Vec<_>>();
        let semaphores = semaphores.iter().map(|(s, _)| *s).collect::<Vec<_>>();
        let info = SemaphoreWaitInfo::default()
            .semaphores(semaphores.as_slice())
            .values(values.as_slice());

        unsafe {
            self.handle.wait_semaphores(&info, u64::MAX)?;
        }

        Ok(())
    }

    pub fn create_semaphore(&self) -> Semaphore {
        let semaphore = unsafe {
            self.handle
                .create_semaphore(&SemaphoreCreateInfo::default(), None)
                .unwrap_or_else(|e| panic!("Error creating semaphore: {e:?}"))
        };

        log::trace!("Created semaphore: {semaphore:?}");
        semaphore
    }

    pub fn create_command_pool(&self, queue: &Queue) -> VkCommandPool {
        let info = CommandPoolCreateInfo::default()
            .flags(CommandPoolCreateFlags::RESET_COMMAND_BUFFER)
            .queue_family_index(queue.family.index);
        unsafe {
            self.handle.create_command_pool(&info, None).unwrap_or_else(|e| {
                panic!(
                    "Error creating command pool for queue {}: {e:?}",
                    queue.family.index
                )
            })
        }
    }
    pub fn create_command_buffers(
        &self,
        pool: &VkCommandPool,
        count: usize,
    ) -> Vec<VkCommandBuffer> {
        let info = CommandBufferAllocateInfo::default()
            .command_buffer_count(count as u32)
            .command_pool(*pool)
            .level(CommandBufferLevel::PRIMARY);

        unsafe {
            self.handle
                .allocate_command_buffers(&info)
                .unwrap_or_else(|e| panic!("Error creating command buffers: {e:?}"))
        }
    }

    pub fn create_sampler(
        &self,
        min_filter: Filter,
        mag_filter: Filter,
        mipmap_mode: SamplerMipmapMode,
        address_mode: SamplerAddressMode,
    ) -> Result<VkSampler> {
        let info = SamplerCreateInfo::default()
            .mag_filter(mag_filter)
            .min_filter(min_filter)
            .min_lod(0.)
            .max_lod(LOD_CLAMP_NONE)
            .mipmap_mode(mipmap_mode)
            .address_mode_u(address_mode)
            .address_mode_v(address_mode);
        Ok(unsafe { self.handle.create_sampler(&info, None)? })
    }

    pub fn pipeline_barrier(
        &self,
        cmd: &CommandBuffer,
        memory_barriers: &[MemoryBarrier2],
        buffer_memory_barriers: &[BufferMemoryBarrier2],
        image_memory_barriers: &[ImageMemoryBarrier2],
    ) -> Result<()> {
        let dependency_info = DependencyInfo::default()
            .memory_barriers(memory_barriers)
            .image_memory_barriers(image_memory_barriers)
            .buffer_memory_barriers(buffer_memory_barriers)
            .dependency_flags(DependencyFlags::BY_REGION);
        unsafe { self.handle.cmd_pipeline_barrier2(cmd.handle, &dependency_info) };
        Ok(())
    }

    pub fn update_descriptor_sets(
        &self,
        writes: &[WriteDescriptorSet],
        copies: &[CopyDescriptorSet],
    ) -> Result<()> {
        unsafe {
            self.handle.update_descriptor_sets(writes, copies);
        }
        Ok(())
    }

    pub fn get_buffer_device_address(&self, buffer: &VkBuffer) -> DeviceAddress {
        unsafe {
            self.handle
                .get_buffer_device_address(&BufferDeviceAddressInfo::default().buffer(*buffer))
        }
    }

    pub fn flush_mapped_memory_ranges(&self, ranges: &[MappedMemoryRange]) {
        unsafe {
            self.handle
                .flush_mapped_memory_ranges(ranges)
                .unwrap_or_else(|e| panic!("Error flushing mapped memory ranges: {e:?}"))
        }
    }

    pub fn wait_for_fences(&self, fences: &[Fence]) {
        log::trace!("Waiting for fences: {:?}", fences);
        unsafe {
            self.handle
                .wait_for_fences(fences, true, TIMEOUT_NS)
                .unwrap_or_else(|e| panic!("Timeout waiting for fences {fences:?}: {e}"))
        }
    }

    pub fn reset_fences(&self, fences: &[Fence]) {
        log::trace!("Resetting fences: {:?}", fences);
        unsafe {
            self.handle
                .reset_fences(fences)
                .unwrap_or_else(|e| panic!("Error resetting fences: {fences:?}: {e}"))
        }
    }

    pub fn create_pipeline_layout(
        &self,
        uniforms_layouts: &[DescriptorSetLayout],
        constants_ranges: &[PushConstantRange],
    ) -> Result<PipelineLayout> {
        let pipeline_layout_info = PipelineLayoutCreateInfo::default()
            .set_layouts(uniforms_layouts)
            .push_constant_ranges(constants_ranges);
        Ok(unsafe { self.handle.create_pipeline_layout(&pipeline_layout_info, None)? })
    }

    pub fn create_graphics_pipeline(&self, info: &GraphicsPipelineCreateInfo) -> Result<Pipeline> {
        Ok(unsafe {
            self.handle
                .create_graphics_pipelines(PipelineCache::null(), slice::from_ref(info), None)
                .map_err(|err| anyhow::anyhow!(err.1))
        }?[0])
    }

    pub fn create_descriptor_set_layout(
        &self,
        bindings: &[DescriptorSetLayoutBinding],
        create_flags: DescriptorSetLayoutCreateFlags,
        binding_flags: &[DescriptorBindingFlags],
    ) -> Result<DescriptorSetLayout> {
        let mut binding_flags_info =
            DescriptorSetLayoutBindingFlagsCreateInfo::default().binding_flags(binding_flags);
        let create_info = DescriptorSetLayoutCreateInfo::default()
            .bindings(bindings)
            .flags(create_flags)
            .push_next(&mut binding_flags_info);

        Ok(unsafe { self.handle.create_descriptor_set_layout(&create_info, None)? })
    }

    pub fn create_descriptor_pool(
        &self,
        pool_sizes: &[DescriptorPoolSize],
        flags: DescriptorPoolCreateFlags,
        max_sets: u32,
    ) -> Result<DescriptorPool> {
        let info = DescriptorPoolCreateInfo::default()
            .pool_sizes(pool_sizes)
            .max_sets(max_sets)
            .flags(flags);
        Ok(unsafe { self.handle.create_descriptor_pool(&info, None)? })
    }

    pub fn create_descriptor_set(
        &self,
        layout: DescriptorSetLayout,
        pool: DescriptorPool,
        variable_descriptor_count: Option<u32>,
    ) -> Result<DescriptorSet> {
        let mut descriptor_set_info = DescriptorSetAllocateInfo::default()
            .descriptor_pool(pool)
            .set_layouts(slice::from_ref(&layout));

        let counts = [variable_descriptor_count.unwrap_or(0)];
        let mut count_info =
            DescriptorSetVariableDescriptorCountAllocateInfo::default().descriptor_counts(&counts);

        if variable_descriptor_count.is_some() {
            descriptor_set_info = descriptor_set_info.push_next(&mut count_info);
        }

        Ok(unsafe { self.handle.allocate_descriptor_sets(&descriptor_set_info)?[0] })
    }

    pub fn create_shader_module(&self, path: &str) -> Result<ShaderModule> {
        let mut file = std::fs::File::open(path)?;
        let bytes = ash::util::read_spv(&mut file)?;
        let info = ShaderModuleCreateInfo::default().code(&bytes);
        let module = unsafe { self.handle.create_shader_module(&info, None) }?;
        Ok(module)
    }

    pub fn queue_submit(
        &self,
        queue: &Queue,
        cmd_buffer_infos: &[CommandBufferSubmitInfo],
        wait_semaphore_infos: &[SemaphoreSubmitInfo],
        signal_semaphores_infos: &[SemaphoreSubmitInfo],
        fence: Fence,
    ) {
        let submit_info = SubmitInfo2::default()
            .command_buffer_infos(&cmd_buffer_infos)
            .wait_semaphore_infos(&wait_semaphore_infos)
            .signal_semaphore_infos(&signal_semaphores_infos);
        unsafe {
            self.handle
                .queue_submit2(**queue, slice::from_ref(&submit_info), fence)
                .unwrap_or_else(|e| panic!("Error submitting {submit_info:?} to {queue:?}: {e}"))
        }
    }
}
