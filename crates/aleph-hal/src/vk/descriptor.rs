
use {anyhow::Result, ash::vk, ash::vk::Handle};
use derive_more::Debug;

#[derive(Debug)]
pub struct DescriptorAllocator {
    pool: vk::DescriptorPool,

    #[debug("{:x}", device.handle().as_raw())]
    device: ash::Device,
}

impl DescriptorAllocator {
    pub fn new(
        device: &ash::Device,
        pool_sizes: &[vk::DescriptorPoolSize],
        max_sets: u32,
    ) -> Result<DescriptorAllocator> {
        let info = vk::DescriptorPoolCreateInfo::default()
            .max_sets(max_sets)
            .pool_sizes(pool_sizes);
        let pool = unsafe { device.create_descriptor_pool(&info, None) }?;

        Ok(DescriptorAllocator {
            pool,
            device: device.clone(),
        })
    }

    pub fn clear(&self) -> Result<()> {
        #[allow(clippy::unit_arg)]
        Ok(unsafe {
            self.device
                .reset_descriptor_pool(self.pool, vk::DescriptorPoolResetFlags::empty())?
        })
    }

    pub fn destroy(&self) {
        unsafe {
            self.device.destroy_descriptor_pool(self.pool, None);
        }
    }

    pub fn allocate(&self, layout: &vk::DescriptorSetLayout) -> Result<vk::DescriptorSet> {
        let layouts = &[*layout];
        let info = vk::DescriptorSetAllocateInfo::default()
            .descriptor_pool(self.pool)
            .set_layouts(layouts);
        let sets = unsafe { self.device.allocate_descriptor_sets(&info) }?;
        Ok(sets[0])
    }

    pub fn update_sets(
        &self,
        writes: &[vk::WriteDescriptorSet],
        copies: &[vk::CopyDescriptorSet],
    ) {
        unsafe {
            self.device.update_descriptor_sets(writes, copies);
        }
    }

    pub fn create_layout(
        &self,
        bindings: &[vk::DescriptorSetLayoutBinding],
        flags: vk::DescriptorSetLayoutCreateFlags,
    ) -> Result<vk::DescriptorSetLayout> {
        let info = vk::DescriptorSetLayoutCreateInfo::default()
            .bindings(bindings)
            .flags(flags);
        Ok(unsafe { self.device.create_descriptor_set_layout(&info, None)? })
    }
}
