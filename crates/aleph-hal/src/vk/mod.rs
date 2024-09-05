// use aleph_gfx::renderer::Renderer;
use {
    crate::vk::{
        device::Device,
        instance::Instance,
        physical_device::PhysicalDevice,
        surface::Surface,
        swapchain::{Swapchain, SwapchainProperties},
    },
    anyhow::Result,
    ash::vk,
    physical_device::PhysicalDevices,
    std::sync::Arc,
    winit::window::Window,
};

pub mod debug;
pub mod device;
pub mod instance;
pub mod physical_device;
pub mod queue;
pub mod surface;
pub mod swapchain;

pub struct RenderBackend {
    pub instance: Arc<Instance>,
    pub physical_device: Arc<PhysicalDevice>,
    pub surface: Arc<Surface>,
    pub swapchain: Arc<Swapchain>,
    pub device: Arc<Device>,
}

impl RenderBackend {
    pub fn new(window: Arc<Window>) -> Result<Arc<Self>> {
        unsafe { Self::init_vulkan(window) }
    }

    unsafe fn init_vulkan(window: Arc<Window>) -> Result<Arc<RenderBackend>> {
        log::info!("Initializing Vulkan");

        let instance = Instance::builder(window.clone()).build()?;
        log::info!("Created instance: {instance:?}");

        let surface = Surface::create(instance.clone(), window.clone())?;
        log::info!("Created surface: {surface:?}");

        let physical_devices = instance.get_physical_devices()?;
        let physical_device = physical_devices.select_default()?;
        let device = Device::create(&instance, &physical_device)?;
        log::info!("Created device: {device:?}");

        let surface_formats = swapchain::Swapchain::enumerate_surface_formats(&device, &surface)?;
        let preferred = vk::SurfaceFormatKHR {
            format: vk::Format::B8G8R8A8_UNORM,
            color_space: vk::ColorSpaceKHR::SRGB_NONLINEAR,
        };

        let format = if surface_formats.contains(&preferred) {
            Some(preferred)
        } else {
            None
        };

        let swapchain = Swapchain::new(
            &device,
            &surface,
            SwapchainProperties {
                format: format.unwrap(),
                dims: vk::Extent2D {
                    width: 640,
                    height: 480,
                },
                vsync: false,
            },
        )?;

        log::info!("Created swapchain: {swapchain:?}");
        let backend = RenderBackend {
            instance: instance.clone(),
            physical_device: physical_device.clone(),
            surface,
            device,
            swapchain,
        };

        Ok(Arc::new(backend))
    }

    // pub fn create_semaphore(
    //     &self,
    //     flags: Option<vk::SemaphoreCreateFlags>,
    // ) -> Result<vk::Semaphore, vk::Result> {
    //     let info = vk::SemaphoreCreateInfo::default()
    //         .flags(flags.unwrap_or(vk::SemaphoreCreateFlags::empty()));
    //     unsafe { self.device.raw.create_semaphore(&info, None) }
    // }

    // pub fn create_fence(
    //     &self,
    //     flags: Option<vk::FenceCreateFlags>,
    // ) -> Result<vk::Fence, vk::Result> {
    //     let info =
    //         vk::FenceCreateInfo::default().flags(flags.unwrap_or(vk::FenceCreateFlags::empty()));
    //     unsafe { self.device.raw.create_fence(&info, None) }
    // }

    // pub fn build_depth_imageview(&self) -> Result<vk::ImageView> {
    //     let instance = &self.instance;
    //     let swapchain = &self.swapchain;
    //     let device = &self.device;
    //     let physical_device = &self.physical_device;

    //     let extent2d = swapchain.properties.dims; // .surface_capabilities.current_extent;
    //     let extent3d = vk::Extent3D {
    //         width: extent2d.width,
    //         height: extent2d.height,
    //         depth: 1,
    //     };
    //     let index = device.universal_queue.family.index;
    //     let indices = [index];
    //     let depth_image_info = vk::ImageCreateInfo::default()
    //         .image_type(vk::ImageType::TYPE_2D)
    //         .format(vk::Format::D32_SFLOAT)
    //         .extent(extent3d)
    //         .mip_levels(1)
    //         .array_layers(1)
    //         .samples(vk::SampleCountFlags::TYPE_1)
    //         .tiling(vk::ImageTiling::OPTIMAL)
    //         .usage(vk::ImageUsageFlags::DEPTH_STENCIL_ATTACHMENT)
    //         .sharing_mode(vk::SharingMode::EXCLUSIVE)
    //         .queue_family_indices(&indices);

    //     let device_memory_properties = unsafe {
    //         instance
    //             .inner
    //             .get_physical_device_memory_properties(physical_device.inner)
    //     };
    //     let depth_image = unsafe { device.raw.create_image(&depth_image_info, None) }?;
    //     let depth_image_memory_req =
    //         unsafe { device.raw.get_image_memory_requirements(depth_image) };
    //     let memory_property_flags = vk::MemoryPropertyFlags::DEVICE_LOCAL;
    //     let depth_image_memory_index: u32 = device_memory_properties.memory_types
    //         [..device_memory_properties.memory_type_count as _]
    //         .iter()
    //         .enumerate()
    //         .find(|(index, memory_type)| {
    //             (1 << index) & depth_image_memory_req.memory_type_bits != 0
    //                 && memory_type.property_flags & memory_property_flags ==
    // memory_property_flags         })
    //         .map(|(index, _memory_type)| index as _)
    //         .expect("Failed to find index for depth image");

    //     let depth_image_allocate_info = vk::MemoryAllocateInfo::default()
    //         .allocation_size(depth_image_memory_req.size)
    //         .memory_type_index(depth_image_memory_index);
    //     let depth_image_memory =
    //         unsafe { device.raw.allocate_memory(&depth_image_allocate_info, None) }?;
    //     unsafe {
    //         device
    //             .raw
    //             .bind_image_memory(depth_image, depth_image_memory, 0)
    //             .expect("Unable to bind depth image memory")
    //     };
    //     let depth_image_view_info = vk::ImageViewCreateInfo::default()
    //         .subresource_range(
    //             vk::ImageSubresourceRange::default()
    //                 .aspect_mask(vk::ImageAspectFlags::DEPTH)
    //                 .level_count(1)
    //                 .layer_count(1),
    //         )
    //         .image(depth_image)
    //         .format(depth_image_info.format)
    //         .view_type(vk::ImageViewType::TYPE_2D);
    //     Ok(unsafe { device.raw.create_image_view(&depth_image_view_info, None)? })
    // }

    // pub fn build_renderpass(&self) -> Result<vk::RenderPass> {
    //     let instance = &self.instance;
    //     let swapchain = &self.swapchain;
    //     let device = &self.device;
    //     let attachments = [
    //         vk::AttachmentDescription::default()
    //             .format(swapchain.properties.format.format)
    //             .load_op(vk::AttachmentLoadOp::CLEAR)
    //             .store_op(vk::AttachmentStoreOp::STORE)
    //             .stencil_load_op(vk::AttachmentLoadOp::DONT_CARE)
    //             .stencil_store_op(vk::AttachmentStoreOp::DONT_CARE)
    //             .initial_layout(vk::ImageLayout::UNDEFINED)
    //             .final_layout(vk::ImageLayout::PRESENT_SRC_KHR)
    //             .samples(vk::SampleCountFlags::TYPE_1),
    //         vk::AttachmentDescription::default()
    //             .format(vk::Format::D32_SFLOAT)
    //             .load_op(vk::AttachmentLoadOp::CLEAR)
    //             .store_op(vk::AttachmentStoreOp::DONT_CARE)
    //             .stencil_load_op(vk::AttachmentLoadOp::DONT_CARE)
    //             .stencil_store_op(vk::AttachmentStoreOp::DONT_CARE)
    //             .initial_layout(vk::ImageLayout::UNDEFINED)
    //             .final_layout(vk::ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL)
    //             .samples(vk::SampleCountFlags::TYPE_1),
    //     ];
    //     let color_refs = [vk::AttachmentReference {
    //         attachment: 0,
    //         layout: vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
    //     }];
    //     let depth_refs = vk::AttachmentReference {
    //         attachment: 1,
    //         layout: vk::ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
    //     };

    //     let subpasses = [vk::SubpassDescription::default()
    //         .color_attachments(&color_refs)
    //         .depth_stencil_attachment(&depth_refs)
    //         .pipeline_bind_point(vk::PipelineBindPoint::GRAPHICS)];
    //     let subpass_dependencies = [vk::SubpassDependency::default()
    //         .src_subpass(vk::SUBPASS_EXTERNAL)
    //         .src_stage_mask(vk::PipelineStageFlags::COLOR_ATTACHMENT_OUTPUT)
    //         .dst_subpass(0)
    //         .dst_stage_mask(vk::PipelineStageFlags::COLOR_ATTACHMENT_OUTPUT)
    //         .dst_access_mask(
    //             vk::AccessFlags::COLOR_ATTACHMENT_READ | vk::AccessFlags::COLOR_ATTACHMENT_WRITE,
    //         )];
    //     let info = vk::RenderPassCreateInfo::default()
    //         .attachments(&attachments)
    //         .subpasses(&subpasses)
    //         .dependencies(&subpass_dependencies);
    //     Ok(unsafe { device.raw.create_render_pass(&info, None)? })
    // }

    // pub fn build_pipeline(
    //     &self,
    //     renderpass: &vk::RenderPass,
    // ) -> Result<(vk::Pipeline, vk::PipelineLayout), vk::Result> {
    //     let instance = &self.instance;
    //     let swapchain = &self.swapchain;
    //     let device = &self.device;
    //     let main_fn_name = std::ffi::CString::new("main").unwrap();

    //     let vertex_shader_info = vk::ShaderModuleCreateInfo::default().code(VERTEX_SHADER);
    //     let vertex_shader_module =
    //         unsafe { device.raw.create_shader_module(&vertex_shader_info, None)? };
    //     let vertex_shader_stage = vk::PipelineShaderStageCreateInfo::default()
    //         .stage(vk::ShaderStageFlags::VERTEX)
    //         .module(vertex_shader_module)
    //         .name(&main_fn_name);

    //     let fragment_shader_info = vk::ShaderModuleCreateInfo::default().code(FRAGMENT_SHADER);
    //     let fragment_shader_module = unsafe {
    //         device
    //             .raw
    //             .create_shader_module(&fragment_shader_info, None)?
    //     };
    //     let fragment_shader_stage = vk::PipelineShaderStageCreateInfo::default()
    //         .stage(vk::ShaderStageFlags::FRAGMENT)
    //         .module(fragment_shader_module)
    //         .name(&main_fn_name);

    //     let shader_stages = vec![vertex_shader_stage, fragment_shader_stage];
    //     let vertex_attribute_descriptions = [
    //         vk::VertexInputAttributeDescription {
    //             binding: 0,
    //             location: 0,
    //             offset: 0,
    //             format: vk::Format::R32G32B32_SFLOAT,
    //         },
    //         vk::VertexInputAttributeDescription {
    //             binding: 1,
    //             location: 1,
    //             offset: 0,
    //             format: vk::Format::R32G32B32A32_SFLOAT,
    //         },
    //         vk::VertexInputAttributeDescription {
    //             binding: 1,
    //             location: 2,
    //             offset: 16,
    //             format: vk::Format::R32G32B32A32_SFLOAT,
    //         },
    //         vk::VertexInputAttributeDescription {
    //             binding: 1,
    //             location: 3,
    //             offset: 32,
    //             format: vk::Format::R32G32B32A32_SFLOAT,
    //         },
    //         vk::VertexInputAttributeDescription {
    //             binding: 1,
    //             location: 4,
    //             offset: 48,
    //             format: vk::Format::R32G32B32A32_SFLOAT,
    //         },
    //         vk::VertexInputAttributeDescription {
    //             binding: 1,
    //             location: 5,
    //             offset: 64,
    //             format: vk::Format::R32G32B32_SFLOAT,
    //         },
    //     ];
    //     let vertex_binding_descriptions = [
    //         vk::VertexInputBindingDescription {
    //             binding: 0,
    //             stride: 12,
    //             input_rate: vk::VertexInputRate::VERTEX,
    //         },
    //         vk::VertexInputBindingDescription {
    //             binding: 1,
    //             stride: 76,
    //             input_rate: vk::VertexInputRate::INSTANCE,
    //         },
    //     ];
    //     let vertex_input_info = vk::PipelineVertexInputStateCreateInfo::default()
    //         .vertex_attribute_descriptions(&vertex_attribute_descriptions)
    //         .vertex_binding_descriptions(&vertex_binding_descriptions);
    //     let input_assembly_info = vk::PipelineInputAssemblyStateCreateInfo::default()
    //         .topology(vk::PrimitiveTopology::TRIANGLE_LIST);

    //     let extent = swapchain.properties.dims;
    //     let viewports = [vk::Viewport {
    //         x: 0.,
    //         y: 0.,
    //         width: extent.width as f32,
    //         height: extent.height as f32,
    //         min_depth: 0.,
    //         max_depth: 1.,
    //     }];
    //     let scissors = [vk::Rect2D {
    //         offset: vk::Offset2D { x: 0, y: 0 },
    //         extent,
    //     }];
    //     let viewport_info = vk::PipelineViewportStateCreateInfo::default()
    //         .viewports(&viewports)
    //         .scissors(&scissors);

    //     let rasterizer_info = vk::PipelineRasterizationStateCreateInfo::default()
    //         .line_width(1.0)
    //         .front_face(vk::FrontFace::COUNTER_CLOCKWISE)
    //         .cull_mode(vk::CullModeFlags::NONE)
    //         .polygon_mode(vk::PolygonMode::FILL);
    //     let multisample_info = vk::PipelineMultisampleStateCreateInfo::default()
    //         .rasterization_samples(vk::SampleCountFlags::TYPE_1);
    //     let color_write_mask = vk::ColorComponentFlags::R
    //         | vk::ColorComponentFlags::G
    //         | vk::ColorComponentFlags::B
    //         | vk::ColorComponentFlags::A;
    //     let color_attachments = [vk::PipelineColorBlendAttachmentState::default()
    //         .blend_enable(true)
    //         .src_color_blend_factor(vk::BlendFactor::SRC_ALPHA)
    //         .dst_color_blend_factor(vk::BlendFactor::ONE_MINUS_SRC_ALPHA)
    //         .color_blend_op(vk::BlendOp::ADD)
    //         .src_alpha_blend_factor(vk::BlendFactor::SRC_ALPHA)
    //         .dst_alpha_blend_factor(vk::BlendFactor::ONE_MINUS_SRC_ALPHA)
    //         .alpha_blend_op(vk::BlendOp::ADD)
    //         .color_write_mask(color_write_mask)];
    //     let color_info =
    //         vk::PipelineColorBlendStateCreateInfo::default().attachments(&color_attachments);
    //     let layout_info = vk::PipelineLayoutCreateInfo::default();
    //     let pipeline_layout = unsafe { device.raw.create_pipeline_layout(&layout_info, None) }?;
    //     let depth_info = vk::PipelineDepthStencilStateCreateInfo::default()
    //         .depth_test_enable(true)
    //         .depth_write_enable(true)
    //         .depth_compare_op(vk::CompareOp::LESS_OR_EQUAL);
    //     let pipeline_info = vk::GraphicsPipelineCreateInfo::default()
    //         .stages(&shader_stages)
    //         .vertex_input_state(&vertex_input_info)
    //         .input_assembly_state(&input_assembly_info)
    //         .viewport_state(&viewport_info)
    //         .rasterization_state(&rasterizer_info)
    //         .multisample_state(&multisample_info)
    //         .depth_stencil_state(&depth_info)
    //         .color_blend_state(&color_info)
    //         .layout(pipeline_layout)
    //         .render_pass(*renderpass)
    //         .subpass(0);
    //     let pipeline = unsafe {
    //         device
    //             .raw
    //             .create_graphics_pipelines(vk::PipelineCache::null(), &[pipeline_info], None)
    //             .expect("Failed to create pipeline")
    //     }[0];

    //     unsafe {
    //         device
    //             .raw
    //             .destroy_shader_module(fragment_shader_module, None);
    //         device.raw.destroy_shader_module(vertex_shader_module, None);
    //     }

    //     Ok((pipeline, pipeline_layout))
    // }
}

/*'

 fn build_swapchain(
    context: &VkContext,
  ) -> Result<(vk::SwapchainKHR, khr::Swapchain, Vec<vk::Image>, Vec<vk::ImageView>), vk::Result> {
    let extent = context.surface_capabilities.current_extent;
    let surface_format = context.surface_formats.first().unwrap();
    let indices = [context.graphics_queue_index];

    let info = vk::SwapchainCreateInfoKHR::builder()
      .surface(context.surface)
      .min_image_count(
        3.max(context.surface_capabilities.min_image_count)
          .min(context.surface_capabilities.max_image_count),
      )
      .image_format(surface_format.format)
      .image_color_space(surface_format.color_space)
      .image_extent(extent)
      .image_array_layers(1)
      .image_usage(vk::ImageUsageFlags::COLOR_ATTACHMENT)
      .image_sharing_mode(vk::SharingMode::EXCLUSIVE)
      .queue_family_indices(&indices)
      .pre_transform(context.surface_capabilities.current_transform)
      .composite_alpha(vk::CompositeAlphaFlagsKHR::OPAQUE)
      .present_mode(vk::PresentModeKHR::FIFO);
    let extension = khr::Swapchain::new(&context.instance, &context.device);
    let swapchain = unsafe { extension.create_swapchain(&info, None)? };

    let images = unsafe { extension.get_swapchain_images(swapchain)? };
    let subresource_range = vk::ImageSubresourceRange::builder()
      .aspect_mask(vk::ImageAspectFlags::COLOR)
      .base_mip_level(0)
      .level_count(1)
      .base_array_layer(0)
      .layer_count(1);
    let imageviews: Vec<vk::ImageView> = images
      .iter()
      .map(|image| {
        let info = vk::ImageViewCreateInfo::builder()
          .image(*image)
          .view_type(vk::ImageViewType::TYPE_2D)
          .format(vk::Format::B8G8R8A8_UNORM)
          .subresource_range(*subresource_range);
        unsafe { context.device.create_image_view(&info, None).expect("Failed to create imageview") }
      })
      .collect();

    Ok((swapchain, extension, images, imageviews))
  }

  fn build_renderpass(
    context: &VkContext,
    surface_format: &vk::SurfaceFormatKHR,
  ) -> Result<vk::RenderPass, vk::Result> {
    let attachments = [
      vk::AttachmentDescription::builder()
        .format(surface_format.format)
        .load_op(vk::AttachmentLoadOp::CLEAR)
        .store_op(vk::AttachmentStoreOp::STORE)
        .stencil_load_op(vk::AttachmentLoadOp::DONT_CARE)
        .stencil_store_op(vk::AttachmentStoreOp::DONT_CARE)
        .initial_layout(vk::ImageLayout::UNDEFINED)
        .final_layout(vk::ImageLayout::PRESENT_SRC_KHR)
        .samples(vk::SampleCountFlags::TYPE_1)
        .build(),
      vk::AttachmentDescription::builder()
        .format(vk::Format::D32_SFLOAT)
        .load_op(vk::AttachmentLoadOp::CLEAR)
        .store_op(vk::AttachmentStoreOp::DONT_CARE)
        .stencil_load_op(vk::AttachmentLoadOp::DONT_CARE)
        .stencil_store_op(vk::AttachmentStoreOp::DONT_CARE)
        .initial_layout(vk::ImageLayout::UNDEFINED)
        .final_layout(vk::ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL)
        .samples(vk::SampleCountFlags::TYPE_1)
        .build(),
    ];
    let color_refs = [vk::AttachmentReference {
      attachment: 0,
      layout:     vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
    }];
    let depth_refs = vk::AttachmentReference {
      attachment: 1,
      layout:     vk::ImageLayout::DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
    };

    let subpasses = [vk::SubpassDescription::builder()
      .color_attachments(&color_refs)
      .depth_stencil_attachment(&depth_refs)
      .pipeline_bind_point(vk::PipelineBindPoint::GRAPHICS)
      .build()];
    let subpass_dependencies = [vk::SubpassDependency::builder()
      .src_subpass(vk::SUBPASS_EXTERNAL)
      .src_stage_mask(vk::PipelineStageFlags::COLOR_ATTACHMENT_OUTPUT)
      .dst_subpass(0)
      .dst_stage_mask(vk::PipelineStageFlags::COLOR_ATTACHMENT_OUTPUT)
      .dst_access_mask(vk::AccessFlags::COLOR_ATTACHMENT_READ | vk::AccessFlags::COLOR_ATTACHMENT_WRITE)
      .build()];
    let info = vk::RenderPassCreateInfo::builder()
      .attachments(&attachments)
      .subpasses(&subpasses)
      .dependencies(&subpass_dependencies);
    unsafe { context.device.create_render_pass(&info, None) }
  }

  fn build_pipeline(
    context: &VkContext,
    renderpass: &vk::RenderPass,
  ) -> Result<(vk::Pipeline, vk::PipelineLayout), vk::Result> {
    let main_fn_name = std::ffi::CString::new("main").unwrap();

    let vertex_shader_info = vk::ShaderModuleCreateInfo::builder().code(VERTEX_SHADER);
    let vertex_shader_module = unsafe { context.device.create_shader_module(&vertex_shader_info, None)? };
    let vertex_shader_stage = vk::PipelineShaderStageCreateInfo::builder()
      .stage(vk::ShaderStageFlags::VERTEX)
      .module(vertex_shader_module)
      .name(&main_fn_name);

    let fragment_shader_info = vk::ShaderModuleCreateInfo::builder().code(FRAGMENT_SHADER);
    let fragment_shader_module = unsafe { context.device.create_shader_module(&fragment_shader_info, None)? };
    let fragment_shader_stage = vk::PipelineShaderStageCreateInfo::builder()
      .stage(vk::ShaderStageFlags::FRAGMENT)
      .module(fragment_shader_module)
      .name(&main_fn_name);

    let shader_stages = vec![vertex_shader_stage.build(), fragment_shader_stage.build()];
    let vertex_attribute_descriptions = [
      vk::VertexInputAttributeDescription {
        binding:  0,
        location: 0,
        offset:   0,
        format:   vk::Format::R32G32B32_SFLOAT,
      },
      vk::VertexInputAttributeDescription {
        binding:  1,
        location: 1,
        offset:   0,
        format:   vk::Format::R32G32B32A32_SFLOAT,
      },
      vk::VertexInputAttributeDescription {
        binding:  1,
        location: 2,
        offset:   16,
        format:   vk::Format::R32G32B32A32_SFLOAT,
      },
      vk::VertexInputAttributeDescription {
        binding:  1,
        location: 3,
        offset:   32,
        format:   vk::Format::R32G32B32A32_SFLOAT,
      },
      vk::VertexInputAttributeDescription {
        binding:  1,
        location: 4,
        offset:   48,
        format:   vk::Format::R32G32B32A32_SFLOAT,
      },
      vk::VertexInputAttributeDescription {
        binding:  1,
        location: 5,
        offset:   64,
        format:   vk::Format::R32G32B32_SFLOAT,
      },
    ];
    let vertex_binding_descriptions = [
      vk::VertexInputBindingDescription {
        binding:    0,
        stride:     12,
        input_rate: vk::VertexInputRate::VERTEX,
      },
      vk::VertexInputBindingDescription {
        binding:    1,
        stride:     76,
        input_rate: vk::VertexInputRate::INSTANCE,
      },
    ];
    let vertex_input_info = vk::PipelineVertexInputStateCreateInfo::builder()
      .vertex_attribute_descriptions(&vertex_attribute_descriptions)
      .vertex_binding_descriptions(&vertex_binding_descriptions);
    let input_assembly_info =
      vk::PipelineInputAssemblyStateCreateInfo::builder().topology(vk::PrimitiveTopology::TRIANGLE_LIST);

    let extent = context.surface_capabilities.current_extent;
    let viewports = [vk::Viewport {
      x:         0.,
      y:         0.,
      width:     extent.width as f32,
      height:    extent.height as f32,
      min_depth: 0.,
      max_depth: 1.,
    }];
    let scissors = [vk::Rect2D {
      offset: vk::Offset2D { x: 0, y: 0 },
      extent,
    }];
    let viewport_info =
      vk::PipelineViewportStateCreateInfo::builder().viewports(&viewports).scissors(&scissors);

    let rasterizer_info = vk::PipelineRasterizationStateCreateInfo::builder()
      .line_width(1.0)
      .front_face(vk::FrontFace::COUNTER_CLOCKWISE)
      .cull_mode(vk::CullModeFlags::NONE)
      .polygon_mode(vk::PolygonMode::FILL);
    let multisample_info =
      vk::PipelineMultisampleStateCreateInfo::builder().rasterization_samples(vk::SampleCountFlags::TYPE_1);
    let color_write_mask = vk::ColorComponentFlags::R
      | vk::ColorComponentFlags::G
      | vk::ColorComponentFlags::B
      | vk::ColorComponentFlags::A;
    let color_attachments = [vk::PipelineColorBlendAttachmentState::builder()
      .blend_enable(true)
      .src_color_blend_factor(vk::BlendFactor::SRC_ALPHA)
      .dst_color_blend_factor(vk::BlendFactor::ONE_MINUS_SRC_ALPHA)
      .color_blend_op(vk::BlendOp::ADD)
      .src_alpha_blend_factor(vk::BlendFactor::SRC_ALPHA)
      .dst_alpha_blend_factor(vk::BlendFactor::ONE_MINUS_SRC_ALPHA)
      .alpha_blend_op(vk::BlendOp::ADD)
      .color_write_mask(color_write_mask)
      .build()];
    let color_info = vk::PipelineColorBlendStateCreateInfo::builder().attachments(&color_attachments);
    let layout_info = vk::PipelineLayoutCreateInfo::builder();
    let pipeline_layout = unsafe { context.device.create_pipeline_layout(&layout_info, None) }?;
    let depth_info = vk::PipelineDepthStencilStateCreateInfo::builder()
      .depth_test_enable(true)
      .depth_write_enable(true)
      .depth_compare_op(vk::CompareOp::LESS_OR_EQUAL);
    let pipeline_info = vk::GraphicsPipelineCreateInfo::builder()
      .stages(&shader_stages)
      .vertex_input_state(&vertex_input_info)
      .input_assembly_state(&input_assembly_info)
      .viewport_state(&viewport_info)
      .rasterization_state(&rasterizer_info)
      .multisample_state(&multisample_info)
      .depth_stencil_state(&depth_info)
      .color_blend_state(&color_info)
      .layout(pipeline_layout)
      .render_pass(*renderpass)
      .subpass(0);
    let pipeline = unsafe {
      context
        .device
        .create_graphics_pipelines(vk::PipelineCache::null(), &[pipeline_info.build()], None)
        .expect("Failed to create pipeline")
    }[0];

    unsafe {
      context.device.destroy_shader_module(fragment_shader_module, None);
      context.device.destroy_shader_module(vertex_shader_module, None);
    }

    Ok((pipeline, pipeline_layout))
  }

  fn build_depth_imageview(context: &VkContext, queue_indices: &[u32]) -> Result<vk::ImageView, vk::Result> {
    let extent2d = context.surface_capabilities.current_extent;
    let extent3d = vk::Extent3D {
      width:  extent2d.width,
      height: extent2d.height,
      depth:  1,
    };
    let depth_image_info = vk::ImageCreateInfo::builder()
      .image_type(vk::ImageType::TYPE_2D)
      .format(vk::Format::D32_SFLOAT)
      .extent(extent3d)
      .mip_levels(1)
      .array_layers(1)
      .samples(vk::SampleCountFlags::TYPE_1)
      .tiling(vk::ImageTiling::OPTIMAL)
      .usage(vk::ImageUsageFlags::DEPTH_STENCIL_ATTACHMENT)
      .sharing_mode(vk::SharingMode::EXCLUSIVE)
      .queue_family_indices(queue_indices);

    let device_memory_properties =
      unsafe { context.instance.get_physical_device_memory_properties(context.physical_device) };
    let depth_image = unsafe { context.device.create_image(&depth_image_info, None) }?;
    let depth_image_memory_req = unsafe { context.device.get_image_memory_requirements(depth_image) };
    let memory_property_flags = vk::MemoryPropertyFlags::DEVICE_LOCAL;
    let depth_image_memory_index: u32 = device_memory_properties.memory_types
      [..device_memory_properties.memory_type_count as _]
      .iter()
      .enumerate()
      .find(|(index, memory_type)| {
        (1 << index) & depth_image_memory_req.memory_type_bits != 0
          && memory_type.property_flags & memory_property_flags == memory_property_flags
      })
      .map(|(index, _memory_type)| index as _)
      .expect("Failed to find index for depth image");

    let depth_image_allocate_info = vk::MemoryAllocateInfo::builder()
      .allocation_size(depth_image_memory_req.size)
      .memory_type_index(depth_image_memory_index);
    let depth_image_memory = unsafe { context.device.allocate_memory(&depth_image_allocate_info, None) }?;
    unsafe {
      context
        .device
        .bind_image_memory(depth_image, depth_image_memory, 0)
        .expect("Unable to bind depth image memory")
    };
    let depth_image_view_info = vk::ImageViewCreateInfo::builder()
      .subresource_range(
        *vk::ImageSubresourceRange::builder()
          .aspect_mask(vk::ImageAspectFlags::DEPTH)
          .level_count(1)
          .layer_count(1),
      )
      .image(depth_image)
      .format(depth_image_info.format)
      .view_type(vk::ImageViewType::TYPE_2D);
    unsafe { context.device.create_image_view(&depth_image_view_info, None) }
  }

*/
