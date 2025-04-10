use {
    aleph::prelude::*, aleph_gfx::renderer::RendererConfig, anyhow::Result,
    std::path::Path,
};

const GLTF_SAMPLE_DIR: &str = "assets/gltf/glTF-Sample-Assets";
const GLTF_VALIDATION_DIR: &str = "assets/gltf/glTF-Asset-Generator";

pub fn sample_path(name: &str) -> Result<String> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(GLTF_SAMPLE_DIR)
        .join(name)
        .join("glTF")
        .join(format!("{name}.gltf"));

    path.canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| anyhow::anyhow!("Failed to load sample path: {:?}", path).context(e))
}

pub fn validation_path(name: &str, index: usize) -> Result<String> {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(GLTF_VALIDATION_DIR)
        .join(name)
        .join(format!("{name}_{index:02}.gltf"))
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| anyhow::anyhow!(e))
}

fn main() {
    let app_config = AppConfig::default().name("Demo");
    let path = sample_path("BoxTextured").expect("Failed to load scene path");
    let render_config = RendererConfig {
        initial_scene: Some(path),
        ..Default::default()
    };

    App::new(app_config)
        .with_layer(UpdateLayer::default())
        .with_layer(RenderLayer::with_config(render_config))
        .run()
        .expect("Error running demo");
}

// struct SetupLayer {}
// impl Layer for SetupLayer {
//     fn init(&mut self, window: &Window, events: EventSubscriber<Self>) -> Result<()> {
//         Ok(())
//     }
// }

// struct LogicLayer {}
// impl Layer for LogicLayer {
//     fn init(&mut self, window: &Window, events: EventSubscriber<Self>) -> Result<()> {
//         Ok(())
//     }
// }
