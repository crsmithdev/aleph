use {
    crate::vk::device::Device,
    anyhow::Result,
    ash::vk,
    std::{fmt::Debug, sync::Arc},
};

pub struct DescriptorAllocator {
    pool: vk::DescriptorPool,
    device: Arc<Device>,
}

impl DescriptorAllocator {
    pub fn new(
        device: &Arc<Device>,
        pool_sizes: &[vk::DescriptorPoolSize],
        max_sets: u32,
    ) -> Result<DescriptorAllocator> {
        let info = vk::DescriptorPoolCreateInfo::default()
            .max_sets(max_sets)
            .pool_sizes(pool_sizes);
        let pool = unsafe { device.inner.create_descriptor_pool(&info, None) }?;

        Ok(DescriptorAllocator {
            pool,
            device: device.clone(),
        })
    }

    pub fn clear(&self) -> Result<()> {
        Ok(unsafe {
            self.device
                .inner
                .reset_descriptor_pool(self.pool, vk::DescriptorPoolResetFlags::empty())?
        })
    }

    pub fn destroy(&self) {
        unsafe {
            self.device.inner.destroy_descriptor_pool(self.pool, None);
        }
    }

    pub fn allocate(&self, layout: &vk::DescriptorSetLayout) -> Result<vk::DescriptorSet> {
        let layouts = &[*layout];
        let info = vk::DescriptorSetAllocateInfo::default()
            .descriptor_pool(self.pool)
            .set_layouts(layouts);
        let sets = unsafe { self.device.inner.allocate_descriptor_sets(&info) }?;
        Ok(sets[0])
    }
}

impl Debug for DescriptorAllocator {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DescriptorAllocator")
            .field("pool", &self.pool)
            .finish()
    }
}
