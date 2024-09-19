use {
    crate::vk::{
        buffer::{Buffer, BufferDesc},
        command_buffer::CommandBuffer,
        instance::Instance,
        physical_device::PhysicalDevice,
        queue::Queue,
    },
    anyhow::Result,
    ash::vk::{self, Handle},
    gpu_allocator::{
        vulkan::{
            Allocation,
            AllocationCreateDesc,
            AllocationScheme,
            Allocator,
            AllocatorCreateDesc,
        },
        MemoryLocation,
    },
    std::{
        fmt,
        ptr,
        sync::{Arc, Mutex},
    },
};

pub struct Semaphore {
    pub inner: vk::Semaphore,
}

pub struct Fence {
    pub inner: vk::Fence,
}

pub struct Texture {
    pub image: vk::Image,
    pub view: vk::ImageView,
    pub memory: vk::DeviceMemory,
}

#[allow(dead_code)]
pub struct Device {
    pub inner: ash::Device,
    pub(crate) physical_device: Arc<PhysicalDevice>,
    pub instance: Arc<Instance>,
    pub queue: Queue,
    pub allocator: Arc<Mutex<Allocator>>,
    pub command_pool: vk::CommandPool,
    pub command_buffer: CommandBuffer,
    pub command_buffer_fence: vk::Fence,
}

impl Device {
    pub fn create(
        instance: &Arc<Instance>,
        physical_device: &Arc<PhysicalDevice>,
    ) -> Result<Arc<Self>> {
        let device_extension_names = vec![ash::khr::swapchain::NAME.as_ptr()];
        let priorities = [1.0];

        let queue_family = physical_device
            .queue_families
            .iter()
            .filter(|qf| qf.properties.queue_flags.contains(vk::QueueFlags::GRAPHICS))
            .copied()
            .next()
            .unwrap();

        let queue_info = [vk::DeviceQueueCreateInfo::default()
            .queue_family_index(queue_family.index)
            .queue_priorities(&priorities)];

        let mut device_features = vk::PhysicalDeviceFeatures2::default();

        let device_info = vk::DeviceCreateInfo::default()
            .queue_create_infos(&queue_info)
            .enabled_extension_names(&device_extension_names)
            .push_next(&mut device_features);

        let device = unsafe {
            instance
                .inner
                .create_device(physical_device.inner, &device_info, None)
                .unwrap()
        };

        log::info!("Created a Vulkan device");

        let allocator = Allocator::new(&AllocatorCreateDesc {
            instance: instance.inner.clone(),
            device: device.clone(),
            physical_device: physical_device.inner,
            buffer_device_address: false,
            debug_settings: Default::default(),
            allocation_sizes: Default::default(),
        })?;

        let queue = Queue {
            inner: unsafe { device.get_device_queue(queue_family.index, 0) },
            family: queue_family,
        };

        let pool_create_info = vk::CommandPoolCreateInfo::default()
            .flags(vk::CommandPoolCreateFlags::RESET_COMMAND_BUFFER)
            .queue_family_index(queue.family.index);

        let command_pool = unsafe { device.create_command_pool(&pool_create_info, None).unwrap() };

        let command_buffer_allocate_info = vk::CommandBufferAllocateInfo::default()
            .command_buffer_count(1)
            .command_pool(command_pool)
            .level(vk::CommandBufferLevel::PRIMARY);

        let command_buffer =
            Self::allocate_command_buffer(device.clone(), command_buffer_allocate_info);
        let fence_create_info =
            vk::FenceCreateInfo::default().flags(vk::FenceCreateFlags::SIGNALED);
        let command_buffer_fence = unsafe {
            device
                .create_fence(&fence_create_info, None)
                .expect("Create fence failed.")
        };

        Ok(Arc::new(Device {
            physical_device: physical_device.clone(),
            command_buffer,
            inner: device,
            instance: instance.clone(),
            queue,
            command_buffer_fence,
            command_pool,
            allocator: Arc::new(Mutex::new(allocator)),
        }))
    }

    pub fn create_fence(&self) -> Result<Fence> {
        let info = vk::FenceCreateInfo::default().flags(vk::FenceCreateFlags::SIGNALED);
        let fence: vk::Fence = unsafe { self.inner.create_fence(&info, None) }?;
        Ok(Fence { inner: fence })
    }

    pub fn create_texture(&self, info: &vk::ImageCreateInfo) -> Texture {
        let image = unsafe { self.inner.create_image(&info, None).unwrap() };
        let memory_properties = &self.physical_device.memory_properties;
        let image_memory_req = unsafe { self.inner.get_image_memory_requirements(image) };
        let image_memory_index = self
            .find_memorytype_index(
                &image_memory_req,
                memory_properties,
                vk::MemoryPropertyFlags::DEVICE_LOCAL,
            )
            .expect("Unable to find suitable memory index for depth image.");

        let image_allocate_info = vk::MemoryAllocateInfo::default()
            .allocation_size(image_memory_req.size)
            .memory_type_index(image_memory_index);

        let memory = unsafe {
            self.inner
                .allocate_memory(&image_allocate_info, None)
                .unwrap()
        };
        unsafe {
            self.inner
                .bind_image_memory(image, memory, 0)
                .expect("Unable to bind depth image memory");
        }

        record_submit_commandbuffer(
            &self.inner,
            self.command_buffer.inner,
            self.command_buffer_fence,
            self.queue.inner,
            &[],
            &[],
            &[],
            |device, setup_command_buffer| {
                let layout_transition_barriers = vk::ImageMemoryBarrier::default()
                    .image(image)
                    .dst_access_mask(
                        vk::AccessFlags::DEPTH_STENCIL_ATTACHMENT_READ
                            | vk::AccessFlags::DEPTH_STENCIL_ATTACHMENT_WRITE,
                    )
                    .new_layout(vk::ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL)
                    .old_layout(vk::ImageLayout::UNDEFINED)
                    .subresource_range(
                        vk::ImageSubresourceRange::default()
                            .aspect_mask(vk::ImageAspectFlags::DEPTH)
                            .layer_count(1)
                            .level_count(1),
                    );

                unsafe {
                    device.cmd_pipeline_barrier(
                        setup_command_buffer,
                        vk::PipelineStageFlags::BOTTOM_OF_PIPE,
                        vk::PipelineStageFlags::LATE_FRAGMENT_TESTS,
                        vk::DependencyFlags::empty(),
                        &[],
                        &[],
                        &[layout_transition_barriers],
                    );
                }
            },
        );

        let depth_image_view_info = vk::ImageViewCreateInfo::default()
            .subresource_range(
                vk::ImageSubresourceRange::default()
                    .aspect_mask(vk::ImageAspectFlags::DEPTH)
                    .level_count(1)
                    .layer_count(1),
            )
            .image(image)
            .format(info.format)
            .view_type(vk::ImageViewType::TYPE_2D);

        let view = self.create_image_view(depth_image_view_info);

        Texture {
            image,
            view,
            memory,
        }
    }

    fn create_image_view(&self, info: vk::ImageViewCreateInfo) -> vk::ImageView {
        unsafe { self.inner.create_image_view(&info, None).unwrap() }
    }

    pub fn create_semaphore(&self) -> Result<Semaphore> {
        let info = vk::SemaphoreCreateInfo::default();
        let semaphore = unsafe { self.inner.create_semaphore(&info, None) }?;
        Ok(Semaphore { inner: semaphore })
    }

    pub fn create_command_buffer(&self) -> CommandBuffer {
        let command_buffer_allocate_info = vk::CommandBufferAllocateInfo::default()
            .command_buffer_count(1)
            .command_pool(self.command_pool)
            .level(vk::CommandBufferLevel::PRIMARY);

        Self::allocate_command_buffer(self.inner.clone(), command_buffer_allocate_info)
    }

    pub fn create_buffer<T>(&self, desc: BufferDesc, initial_data: Option<&[T]>) -> Result<Buffer> {
        let mut flags: vk::BufferUsageFlags = desc.usage.into();
        if initial_data.is_some() {
            flags |= vk::BufferUsageFlags::TRANSFER_DST;
        }
        let initial_data = initial_data.unwrap();
        let size = initial_data.len() * size_of::<T>();
        let (buffer, allocation) = allocate(
            &self.allocator,
            &self.inner,
            size,
            flags,
            MemoryLocation::CpuToGpu,
        )
        .unwrap();

        self.write_buffer(&allocation, initial_data)?;
        Ok(Buffer {
            inner: buffer,
            allocation,
        })
    }

    pub fn write_buffer<T: Sized>(&self, allocation: &Allocation, data: &[T]) -> Result<()> {
        let buffer_ptr = allocation.mapped_ptr().unwrap().cast().as_ptr();
        unsafe { ptr::copy_nonoverlapping(data.as_ptr(), buffer_ptr, data.len()) }

        Ok(())
    }

    pub fn wait_for_fence(&self, fence: &Fence) -> Result<()> {
        unsafe {
            self.inner
                .wait_for_fences(&[fence.inner], true, std::u64::MAX)?;
            self.inner.reset_fences(&[fence.inner])?
        }
        Ok(())
    }
    fn find_memorytype_index(
        &self,
        memory_req: &vk::MemoryRequirements,
        memory_prop: &vk::PhysicalDeviceMemoryProperties,
        flags: vk::MemoryPropertyFlags,
    ) -> Option<u32> {
        memory_prop.memory_types[..memory_prop.memory_type_count as _]
            .iter()
            .enumerate()
            .find(|(index, memory_type)| {
                (1 << index) & memory_req.memory_type_bits != 0
                    && memory_type.property_flags & flags == flags
            })
            .map(|(index, _memory_type)| index as _)
    }

    fn allocate_command_buffer(
        device: ash::Device,
        info: vk::CommandBufferAllocateInfo,
    ) -> CommandBuffer {
        let command_buffers = unsafe { device.allocate_command_buffers(&info).unwrap() };

        CommandBuffer {
            inner: command_buffers[0],
        }
    }
}

impl fmt::Debug for Device {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Device")
            .field(
                "inner",
                &format_args!("{:x}", &self.inner.handle().as_raw()),
            )
            .field("instance", &self.instance)
            .field("physical_device", &self.physical_device)
            .finish_non_exhaustive()
    }
}
pub fn record_submit_commandbuffer<F: FnOnce(&ash::Device, vk::CommandBuffer)>(
    device: &ash::Device,
    command_buffer: vk::CommandBuffer,
    command_buffer_reuse_fence: vk::Fence,
    submit_queue: vk::Queue,
    wait_mask: &[vk::PipelineStageFlags],
    wait_semaphores: &[vk::Semaphore],
    signal_semaphores: &[vk::Semaphore],
    f: F,
) {
    unsafe {
        device
            .wait_for_fences(&[command_buffer_reuse_fence], true, u64::MAX)
            .expect("Wait for fence failed.");

        device
            .reset_fences(&[command_buffer_reuse_fence])
            .expect("Reset fences failed.");

        device
            .reset_command_buffer(
                command_buffer,
                vk::CommandBufferResetFlags::RELEASE_RESOURCES,
            )
            .expect("Reset command buffer failed.");

        let command_buffer_begin_info = vk::CommandBufferBeginInfo::default()
            .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT);

        device
            .begin_command_buffer(command_buffer, &command_buffer_begin_info)
            .expect("Begin commandbuffer");
        f(device, command_buffer);
        device
            .end_command_buffer(command_buffer)
            .expect("End commandbuffer");

        let command_buffers = vec![command_buffer];

        let submit_info = vk::SubmitInfo::default()
            .wait_semaphores(wait_semaphores)
            .wait_dst_stage_mask(wait_mask)
            .command_buffers(&command_buffers)
            .signal_semaphores(signal_semaphores);

        device
            .queue_submit(submit_queue, &[submit_info], command_buffer_reuse_fence)
            .expect("queue submit failed.");
    }
}

fn allocate(
    allocator: &Arc<Mutex<Allocator>>,
    device: &ash::Device,
    bytes: usize,
    flags: vk::BufferUsageFlags,
    location: MemoryLocation,
) -> Result<(vk::Buffer, Allocation)> {
    let mut allocator = allocator.lock().unwrap();
    let info = vk::BufferCreateInfo::default()
        .size(bytes as u64)
        .usage(flags);
    let buffer = unsafe { device.create_buffer(&info, None) }?;
    let requirements = unsafe { device.get_buffer_memory_requirements(buffer) };

    let allocation = allocator.allocate(&AllocationCreateDesc {
        name: "Buffer",
        requirements,
        location,
        linear: true,
        allocation_scheme: AllocationScheme::GpuAllocatorManaged,
    })?;

    unsafe { device.bind_buffer_memory(buffer, allocation.memory(), allocation.offset()) }?;

    Ok((buffer, allocation))
}
