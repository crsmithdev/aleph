pub mod mesh;
pub mod renderer;
pub mod ui;
use {
    crate::ui::UiRenderer,
    aleph_core::{
        app::TickEvent,
        layer::{Layer, Window},
    },
    aleph_hal::{self, DeletionQueue, Frame, Gpu},
    anyhow::Result,
    renderer::SceneRenderer,
    std::{
        fmt,
        sync::{Arc, OnceLock},
    },
};

pub struct RenderContex<'a> {
    pub gfx: &'a Gpu,
}

#[derive(Default, Debug)]
pub struct GraphicsLayer {
    renderer: OnceLock<Renderer>,
}

impl Layer for GraphicsLayer {
    fn init(
        &mut self,
        window: Arc<Window>,
        mut events: aleph_core::events::EventSubscriber<Self>,
    ) -> anyhow::Result<()>
    where
        Self: Sized,
    {
        let renderer = Renderer::new(Arc::clone(&window))?;
        log::info!("Created renderer: {:?}", &renderer);

        self.renderer
            .set(renderer)
            .map_err(|_| anyhow::anyhow!("Failed to set renderer"))?;

        events.subscribe::<TickEvent>(|layer, _event| layer.render());

        Ok(())
    }
}

impl GraphicsLayer {
    pub fn render(&mut self) -> anyhow::Result<()> {
        self.renderer
            .get_mut()
            .expect("Renderer not initialized")
            .render()
    }
}

pub struct Renderer {
    gpu: Gpu,
    frames: Vec<Frame>,
    scene_renderer: SceneRenderer,
    ui: UiRenderer,
    rebuild_swapchain: bool,
    current_frame: usize,
}

impl fmt::Debug for Renderer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Renderer").finish_non_exhaustive()
    }
}

impl Renderer {
    pub fn new(window: Arc<winit::window::Window>) -> Result<Self> {
        let gpu = Gpu::new(window)?;
        let pool = gpu.create_command_pool()?;
        let mut imm_cmd = pool.create_command_buffer()?;

        // crate::mesh::load_meshes("assets/basicmesh.glb".to_string(), &gpu,&imm_cmd)?;

        let scene_renderer = SceneRenderer::new(&gpu, &mut imm_cmd)?;
        let ui = UiRenderer::new(&gpu)?;
        let frames = Self::init_frames(&gpu)?;

        imm_cmd.deletion_queue.flush();

        Ok(Self {
            gpu,
            frames,
            scene_renderer,
            ui,
            current_frame: 0,
            rebuild_swapchain: false,
        })
    }

    pub fn ui_mut(&mut self) -> &mut UiRenderer {
        &mut self.ui
    }

    fn init_frames(gpu: &Gpu) -> Result<Vec<Frame>> {
        (0..gpu.swapchain().in_flight_frames())
            .map(|_| {
                let pool = gpu.create_command_pool()?;
                let command_buffer = pool.create_command_buffer()?;

                Ok(Frame {
                    swapchain_semaphore: gpu.create_semaphore()?,
                    render_semaphore: gpu.create_semaphore()?,
                    fence: gpu.create_fence_signaled()?,
                    command_pool: pool,
                    command_buffer,
                    deletion_queue: DeletionQueue::default(),
                })
            })
            .collect()
    }

    pub fn handle_event(&mut self, event: &winit::event::Event<()>) {
        self.ui.handle_event(event.clone());
    }

    pub fn rebuild_swapchain(&mut self) -> Result<()> {
        self.gpu.rebuild_swapchain()?;
        self.frames = Self::init_frames(&self.gpu)?;
        self.rebuild_swapchain = false;

        Ok(())
    }

    pub fn render(&mut self) -> Result<()> {
        if self.rebuild_swapchain {
            self.rebuild_swapchain()?;
            return Ok(());
        }

        let gpu = &mut self.gpu;
        let n_frames = self.frames.len();
        let frame = &mut self.frames[self.current_frame % n_frames];
        let fence = frame.fence;
        let command_buffer = &frame.command_buffer;
        let render_semaphore = &frame.render_semaphore;
        let swapchain_semaphore = &frame.swapchain_semaphore;
        let deletion_queue = &mut frame.deletion_queue;

        gpu.wait_for_fence(fence)?;
        deletion_queue.flush();
        let (image_index, rebuild) = gpu.swapchain_mut().next_image(*swapchain_semaphore)?;
        let swapchain_image_view = gpu.swapchain().current_image_view();
        self.rebuild_swapchain = rebuild;

        gpu.reset_fence(fence)?;
        command_buffer.reset()?;
        command_buffer.begin()?;

        self.scene_renderer
            .render(gpu, command_buffer)?;
        self.ui.render(gpu, command_buffer, &swapchain_image_view)?;

        command_buffer.end()?;
        command_buffer.submit_queued(swapchain_semaphore, render_semaphore, fence)?;
        let rebuild = self
            .gpu
            .swapchain_mut()
            .present(&[*render_semaphore], &[image_index])?;

        self.rebuild_swapchain |= rebuild;
        self.current_frame = self.current_frame.wrapping_add(1);

        Ok(())
    }
}
