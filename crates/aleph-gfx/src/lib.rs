pub mod mesh;
pub mod renderer;
pub mod ui;
use {
    crate::ui::UiRenderer,
    aleph_hal::{self, Context, CommandPool, CommandBuffer, Frame},
    anyhow::Result,
    gltf::Gltf,
    renderer::SceneRenderer,
    std::{fmt, },
};
#[allow(dead_code)]
pub struct GraphicsLayer {
    context: Context,
    frames: Vec<Frame>,
    scene_renderer: SceneRenderer,
    ui: UiRenderer,
    rebuild_swapchain: bool,
    current_frame: usize,
    imm_cmd: CommandBuffer,
}

impl fmt::Debug for GraphicsLayer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Renderer").finish_non_exhaustive()
    }
}

impl GraphicsLayer {
    pub fn new(context: Context) -> Result<Self> {
        let pool = context.command_pool();
        let imm_cmd = context.create_command_buffer(pool)?;

        let scene_renderer = SceneRenderer::new(&context, imm_cmd.clone())?;   
        let ui = UiRenderer::new(&context)?;
        let frames = Self::init_frames(&context)?;

        let gltf = Gltf::open("assets/basicmesh.glb")?;
        for scene in gltf.scenes() {
            for node in scene.nodes() {
                println!(
                    "Node #{} has {} children",
                    node.index(),
                    node.children().count(),
                );
            }
        }

        Ok(Self {
            context,
            frames,
            scene_renderer,
            ui,
            current_frame: 0,
            rebuild_swapchain: false,
            imm_cmd,
        })
    }

    pub fn ui_mut(&mut self) -> &mut UiRenderer {
        &mut self.ui
    }

    fn init_frames(context: &Context) -> Result<Vec<Frame>> {
        (0..context.swapchain().in_flight_frames())
            .map(|_| {
                // let command_pool = context.create_command_pool()?;
                let pool = context.command_pool();
                let command_buffer = context.create_command_buffer(pool)?;

                Ok(Frame {
                    swapchain_semaphore: context.create_semaphore()?,
                    render_semaphore: context.create_semaphore()?,
                    fence: context.create_fence_signaled()?,
                    command_pool: pool.clone(),
                    command_buffer,
                })
            })
            .collect()
    }

    pub fn handle_event(&mut self, event: &winit::event::Event<()>) {
        self.ui.handle_event(event.clone());
    }

    pub fn rebuild_swapchain(&mut self) -> Result<()> {
        self.context.rebuild_swapchain()?;
        self.frames = Self::init_frames(&self.context)?;
        self.rebuild_swapchain = false;

        Ok(())
    }

    pub fn render(&mut self) -> Result<()> {
        if self.rebuild_swapchain {
            self.rebuild_swapchain()?;
            return Ok(());
        }

        let context = &mut self.context;
        let frame = &self.frames[self.current_frame % self.frames.len()];
        let fence = frame.fence;
        let command_buffer = &frame.command_buffer;
        let render_semaphore = &frame.render_semaphore;
        let swapchain_semaphore = &frame.swapchain_semaphore;

        context.wait_for_fence(fence)?;
        let (image_index, rebuild) = context.swapchain_mut().next_image(*swapchain_semaphore)?;
        let swapchain_image_view = context.swapchain().current_image_view();
        self.rebuild_swapchain = rebuild;

        context.reset_fence(fence)?;
        command_buffer.reset()?;
        command_buffer.begin()?;

        self.scene_renderer.render(context, command_buffer)?;
        self.ui
            .render(context, command_buffer, &swapchain_image_view)?;

        command_buffer.end()?;
        command_buffer.submit_queued(swapchain_semaphore, render_semaphore, fence)?;
        let rebuild = self
            .context
            .swapchain_mut()
            .present(&[*render_semaphore], &[image_index])?;

        self.rebuild_swapchain |= rebuild;
        self.current_frame = self.current_frame.wrapping_add(1);

        Ok(())
    }
}
