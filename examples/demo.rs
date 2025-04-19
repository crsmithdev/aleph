#![feature(concat_idents)]

use {
    aleph::prelude::*,
    aleph_core::{
        input::{InputState, Key, MouseButton, NamedKey},
        log,
        system::{Res, ResMut, Schedule},
    },
    aleph_gfx::renderer::RendererConfig,
    aleph_scene::{assets::Assets, gltf, NodeData, Scene},
    anyhow::Result,
    glam::Vec3,
    smol_str::SmolStr,
    std::path::Path,
};

const AUTOROTATE_DELTA: f32 = 0.01;
const GLTF_SAMPLE_DIR: &str = "assets/gltf/glTF-Sample-Assets";
const SCENE_NAME: &str = "Suzanne";

struct State {
    auto_rotate: bool,
}

fn init(mut scene: ResMut<Scene>, mut assets: ResMut<Assets>) {
    let path = path_to_scene(SCENE_NAME).unwrap_or_else(|err| {
        log::error!("Error loading scene {:?}: {:?}", SCENE_NAME, err);
        panic!()
    });

    let desc = gltf::load_scene(&path, &mut assets).unwrap_or_else(|err| {
        log::error!("Error loading scene {:?}: {}", path, err);
        panic!()
    });
    scene.load(desc).expect("Error loading scene");
}

pub fn path_to_scene(name: &str) -> Result<String> {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(GLTF_SAMPLE_DIR)
        .join(name)
        .join("glTF")
        .join(format!("{name}.gltf"))
        .canonicalize()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|_| anyhow::anyhow!("Invalid path: {:?}", name))
}

fn update(input: Res<InputState>, mut scene: ResMut<Scene>, state: &mut State) {
    let multiplier = (input.key_pressed(&Key::Named(NamedKey::Shift)) as u32 * 2) as f32;
    if input.mouse_held(&MouseButton::Right) {
        if let Some(delta) = input.mouse_delta() {
            scene.camera.rotate(delta * multiplier);
        }
    }

    if input.key_pressed(&Key::Character(SmolStr::new("R"))) {
        state.auto_rotate = !state.auto_rotate;
    }

    if let Some(delta) = input.mouse_scroll_delta() {
        let translation = Vec3::new(0.0, 0.0, delta * multiplier);
        scene.camera.translate(translation);
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
    let mut state = State { auto_rotate: false };

    App::new(config)
        .with_system(Schedule::Startup, init)
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
