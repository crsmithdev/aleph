use {
    aleph::prelude::*,
    aleph_core::{
        input::{InputState, Key, MouseButton},
        log,
        system::{Res, ResMut, Schedule},
    },
    aleph_gfx::renderer::RendererConfig,
    aleph_scene::{assets::Assets, gltf, NodeData, Scene},
    anyhow::Result,
    smol_str::SmolStr,
    std::path::Path,
};

const AUTOROTATE_DELTA: f32 = 0.01;
const GLTF_SAMPLE_DIR: &str = "submodules/glTF-Sample-Assets/Models";
const GLTF_VALIDATION_DIR: &str = "submodules/glTF-Asset-Generator/Output/Positive";
const SCENE_NUMBER: usize = 3;
static SAMPLE_SCENES: &[&'static str] = &["Box", "BoxTextured", "NormalTangentTest", "Suzanne"];
static VALIDATION_SCENES: &[(&'static str, usize, usize)] = &[("Mesh_PrimitivesUV", 0, 8)];

struct State {
    auto_rotate: bool,
    scenes: Vec<String>,
}

impl Default for State {
    fn default() -> Self {
        let mut scenes = Vec::new();
        for (name, start, end) in VALIDATION_SCENES {
            for i in *start..=*end {
                scenes.push(validation_path(name, i).unwrap_or_else(|err| {
                    println!("Error loading scene {:?}: {}", name, err);
                    panic!()
                }));
            }
        }
        for name in SAMPLE_SCENES {
            scenes.push(sample_path(name).unwrap_or_else(|_| {
                log::error!("Error loading scene: {:?}", name);
                panic!()
            }));
        }
        Self {
            auto_rotate: false,
            scenes,
        }
    }
}

fn init(mut scene: ResMut<Scene>, mut assets: ResMut<Assets>, scene_path: &str) {
    gltf::load_scene(scene_path, &mut assets)
        .and_then(|desc| scene.load(desc))
        .unwrap_or_else(|err| {
            log::error!("Error loading scene {:?}: {}", scene_path, err);
            panic!()
        });
}

pub fn sample_path(name: &str) -> Result<String> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(GLTF_SAMPLE_DIR)
        .join(name)
        .join("glTF")
        .join(format!("{name}.gltf"));

    path.canonicalize()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|_| anyhow::anyhow!("Invalid path: {:?}", &path))
}

pub fn validation_path(name: &str, index: usize) -> Result<String> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(GLTF_VALIDATION_DIR)
        .join(name)
        .join(format!("{name}_{index:02}.gltf"));

    path.canonicalize()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|_| anyhow::anyhow!("Invalid path: {:?}", &path))
}

fn update(input: Res<InputState>, mut scene: ResMut<Scene>, state: &mut State) {
    if input.mouse_held(&MouseButton::Right) {
        if let Some(delta) = input.mouse_delta() {
            scene.camera.rotate(delta * 0.01);
        }
    }

    if input.key_pressed(&Key::Character(SmolStr::new("R"))) {
        state.auto_rotate = !state.auto_rotate;
    }

    if let Some(delta) = input.mouse_scroll_delta() {
        scene.camera.zoom(delta * 0.1);
    }

    if state.auto_rotate {
        scene.nodes_mut().for_each(|node| {
            if let NodeData::Mesh(_) = node.data {
                node.rotate(AUTOROTATE_DELTA);
            }
        });
    }
}

fn main() {
    let config = AppConfig::default().name("Demo");
    let mut state = State::default();
    let path = state.scenes[SCENE_NUMBER].clone();

    App::new(config)
        .with_system(
            Schedule::Startup,
            move |scene: ResMut<Scene>, assets: ResMut<Assets>| {
                init(scene, assets, &path);
            },
        )
        .with_system(
            Schedule::Default,
            move |input: Res<InputState>, scene: ResMut<Scene>| {
                update(input, scene, &mut state);
            },
        )
        .with_layer(RenderLayer::with_config(RendererConfig::default()))
        .run()
        .expect("Error running demo");
}
