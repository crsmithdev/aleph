use ash::vk;

pub struct Queue {
    pub inner: vk::Queue,
    pub family: QueueFamily,
}

#[derive(Copy, Clone)]
pub struct QueueFamily {
    pub index: u32,
    pub properties: vk::QueueFamilyProperties,
}
