#![feature(concat_idents)]

use {
    aleph::prelude::*,
    aleph_core::{
        input::{InputState, Key, MouseButton},
        log,
        system::{Res, ResMut, Schedule},
    },
    aleph_gfx::renderer::RendererConfig,
    aleph_scene::{assets::Assets, gltf, NodeData, Scene},
    aleph_vk::Gpu,
    anyhow::Result,
    smol_str::SmolStr,
    std::path::Path,
};

const AUTOROTATE_DELTA: f32 = 0.01;
const GLTF_SAMPLE_DIR: &str = "submodules/glTF-Sample-Assets/Models";
const GLTF_VALIDATION_DIR: &str = "submodules/glTF-Asset-Generator/Output/Positive";

struct State {
    auto_rotate: bool,
}

// fn init(gpu: Res<Gpu>, mut assets: ResMut<Assets>) {
// // let path = path_to_validation("Mesh_PrimitivesUV", 1).unwrap_or_else(|err| {
// // log::error!("Error loading scene: {:?}", err);
// // panic!()
// // });
// let path = path_to_scene("Box").unwrap_or_else(|err| {
//     log::error!("Error loading scene: {:?}", err);
//     panic!()
// });
// let desc = gltf::load(&gpu, &path).unwrap_or_else(|err| {
//     log::error!("Error loading scene {:?}: {}", path, err);
//     panic!()
// });

// let desc = gltf::load_scene(&path, &mut assets).unwrap_or_else(|err| {
//     log::error!("Error loading scene {:?}: {}", path, err);
//     panic!()
// });
// scene.load(desc).expect("Error loading scene");
// }

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

pub fn path_to_validation(name: &str, index: usize) -> Result<String> {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(GLTF_VALIDATION_DIR)
        .join(name)
        .join(format!("{name}_{index:02}.gltf"))
        .canonicalize()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|_| anyhow::anyhow!("Invalid path: {:?}", name))
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

    // if state.auto_rotate {
    //     scene.nodes_mut().for_each(|node| {
    //         if let NodeData::Mesh(_) = node.data {
    //             node.rotate(AUTOROTATE_DELTA);
    //         }
    //     });
    // }
}

fn main() {
    let config = AppConfig::default().name("Demo");
    let mut state = State { auto_rotate: false };

    App::new(config)
        // .with_system(Schedule::Startup, init)
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
