use {
    crate::{CommandBuffer, Instance},
    aleph_core::constants,
    anyhow::{anyhow, bail, Result},
    ash::{
        ext,
        khr,
        vk::{self, Handle},
    },
    derive_more::{Debug, Deref},
    std::ffi,
};

const DEVICE_EXTENSIONS: [&ffi::CStr; 7] = [
    khr::swapchain::NAME,
    khr::synchronization2::NAME,
    khr::maintenance3::NAME,
    khr::dynamic_rendering::NAME,
    ext::descriptor_indexing::NAME,
    khr::buffer_device_address::NAME,
    khr::push_descriptor::NAME,
];

#[allow(dead_code)]
#[derive(Clone, Copy, Debug)]
pub struct QueueFamily {
    pub(crate) index: u32,
    pub(crate) properties: vk::QueueFamilyProperties,
}

impl QueueFamily {
    pub fn index(&self) -> u32 {
        self.index
    }
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug)]
pub struct Queue {
    pub(crate) handle: vk::Queue,
    pub(crate) family: QueueFamily,
}
impl Queue {
    pub fn handle(&self) -> vk::Queue {
        self.handle
    }
    pub fn family(&self) -> QueueFamily {
        self.family
    }
}

#[derive(Clone, Debug, Deref)]
pub struct Device {
    #[deref]
    #[debug("{:x}", handle.handle().as_raw())]
    pub(crate) handle: ash::Device, // TODO
    pub(crate) queue: Queue,
    pub(crate) physical_device: vk::PhysicalDevice,

    #[debug("{:x}", push_descriptor.device().as_raw())]
    pub(crate) push_descriptor: khr::push_descriptor::Device,
}

impl Device {
    // #region Construction

    pub fn new(instance: &Instance) -> Result<Device> {
        let candidate_devices = instance.enumerate_physical_devices()?;

        let selected = candidate_devices
            .into_iter()
            .rev()
            .max_by_key(|d| Self::rank_physical_device(instance, d));

        let physical_device =
            selected.ok_or_else(|| anyhow!("No suitable physical device found"))?;
        let queue_family = Self::init_queue_familiy(instance, &physical_device)?;

        let device_extension_names: Vec<*const i8> = DEVICE_EXTENSIONS
            .iter()
            .map(|n| n.as_ptr())
            .collect::<Vec<_>>();

        let mut synchronization_features =
            ash::vk::PhysicalDeviceSynchronization2FeaturesKHR::default().synchronization2(true);
        let mut dynamic_rendering_features =
            ash::vk::PhysicalDeviceDynamicRenderingFeaturesKHR::default().dynamic_rendering(true);
        let mut buffer_device_address_features =
            ash::vk::PhysicalDeviceBufferDeviceAddressFeaturesKHR::default()
                .buffer_device_address(true);
        let mut device_features = vk::PhysicalDeviceFeatures2::default()
            .push_next(&mut dynamic_rendering_features)
            .push_next(&mut synchronization_features)
            .push_next(&mut buffer_device_address_features);

        // let priorities = [1.0];
        // let queue_info = [vk::DeviceQueueCreateInfo::default()
        //     .queue_family_index(queue_family.index)
        //     .queue_priorities(&priorities)];
        // let device_info = vk::DeviceCreateInfo::default()
        //     .queue_create_infos(&queue_info)
        //     .enabled_extension_names(&device_extension_names)
        //     .push_next(&mut device_features);

        let handle = instance.create_device(
            physical_device,
            queue_family,
            &device_extension_names,
            &mut device_features,
        )?;
        // &device_info, None)? };
        let queue = Self::create_queue(&handle, queue_family);

        let push_descriptor = khr::push_descriptor::Device::new(&instance.handle, &handle);

        Ok(Device {
            handle,
            physical_device,
            queue,
            push_descriptor,
        })
    }

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

    // #region Child Object Creation

    fn create_queue(handle: &ash::Device, family: QueueFamily) -> Queue {
        let handle = unsafe { handle.get_device_queue(family.index, 0) };
        crate::Queue { handle, family }
    }

    // #region Test2

    pub fn create_command_pool(&self) -> Result<vk::CommandPool> {
        let info = vk::CommandPoolCreateInfo::default()
            .flags(vk::CommandPoolCreateFlags::RESET_COMMAND_BUFFER)
            .queue_family_index(self.queue.family().index());
        Ok(unsafe { self.handle.create_command_pool(&info, None)? })
    }

    pub fn create_command_buffer(self: &Device, pool: vk::CommandPool) -> Result<CommandBuffer> {
        let info = vk::CommandBufferAllocateInfo::default()
            .command_buffer_count(1)
            .command_pool(pool)
            .level(vk::CommandBufferLevel::PRIMARY);

        let inner = unsafe {
            self.handle
                .allocate_command_buffers(&info)
                .map(|b| b[0])
                .map_err(anyhow::Error::from)
        }?;

        Ok(CommandBuffer {
            handle: inner,
            pool,
            device: self.clone(),
        })
    }

    pub fn clone_inner(&self) -> ash::Device {
        self.handle.clone()
    }

    fn init_queue_familiy(
        instance: &Instance,
        physical_device: &vk::PhysicalDevice,
    ) -> Result<QueueFamily> {
        let queue_families = instance.get_physical_device_queue_family_properties(*physical_device);
        let selected = queue_families
            .into_iter()
            .enumerate()
            .find(|(_, qf)| qf.queue_flags.contains(vk::QueueFlags::GRAPHICS));

        match selected {
            Some((index, properties)) => Ok(QueueFamily {
                index: index as _,
                properties,
            }),
            None => bail!("No suitable queue family found"),
        }
    }

    pub fn handle(&self) -> &ash::Device {
        &self.handle
    }
    pub fn create_fence(&self) -> Result<vk::Fence> {
        Ok(unsafe {
            self.handle
                .create_fence(&vk::FenceCreateInfo::default(), None)?
        })
    }

    pub fn create_fence_signaled(&self) -> Result<vk::Fence> {
        Ok(unsafe {
            self.handle.create_fence(
                &vk::FenceCreateInfo::default().flags(vk::FenceCreateFlags::SIGNALED),
                None,
            )?
        })
    }

    pub fn update_descriptor_sets(
        &self,
        writes: &[vk::WriteDescriptorSet],
        copies: &[vk::CopyDescriptorSet],
    ) {
        unsafe {
            self.handle.update_descriptor_sets(writes, copies);
        }
    }

    pub fn create_descriptor_set_layout(
        &self,
        bindings: &[vk::DescriptorSetLayoutBinding],
        flags: vk::DescriptorSetLayoutCreateFlags,
    ) -> Result<vk::DescriptorSetLayout> {
        let info = vk::DescriptorSetLayoutCreateInfo::default()
            .bindings(bindings)
            .flags(flags);
        Ok(unsafe { self.handle.create_descriptor_set_layout(&info, None)? })
    }

    pub fn wait_for_fence(&self, fence: vk::Fence) -> Result<()> {
        #[allow(clippy::unit_arg)]
        Ok(unsafe {
            self.handle
                .wait_for_fences(&[fence], true, constants::VK_TIMEOUT_NS)?
        })
    }

    pub fn reset_fence(&self, fence: vk::Fence) -> Result<()> {
        #[allow(clippy::unit_arg)]
        Ok(unsafe { self.handle.reset_fences(&[fence])? })
    }

    pub fn create_semaphore(&self) -> Result<vk::Semaphore> {
        #[allow(clippy::unit_arg)]
        Ok(unsafe {
            self.handle
                .create_semaphore(&vk::SemaphoreCreateInfo::default(), None)?
        })
    }
}
