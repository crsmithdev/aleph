use {
    aleph::prelude::*,
    aleph_core::{
        input::{Input, Key, MouseButton},
        system::{Res, ResMut, Schedule},
    },
    aleph_scene::{assets::Assets, gltf, NodeData, Scene},
    anyhow::Result,
    std::{
        path::Path,
        sync::{LazyLock, Mutex},
    },
};

const SCENE_ROOT: &str = "submodules/glTF-Sample-Assets/Models/";
const SCENE_PATHS: &[&str] = &[
    "Box/glTF/Box.gltf",
    "Suzanne/glTF/Suzanne.gltf",
    "BoomboxWithAxes/glTF/BoomboxWithAxes.gltf",
    "NormalTangentTest/glTF/NormalTangentTest.gltf",
    "MetalRoughSpheres/glTF/MetalRoughSpheres.gltf",
    "MetalRoughSpheresNoTextures/glTF/MetalRoughSpheresNoTextures.gltf",
    "OrientationTest/glTF/OrientationTest.gltf",
];
const VALILDATION_ROOT: &str = "submodules/glTF-Asset-Generator/Output/Positive";
const VALIDATION_PATHS: &[(&str, usize)] = &[
    ("Material/Material_00.gltf", 7),
    (
        "Material_MetallicRoughness/Material_MetallicRoughness_00.gltf",
        11,
    ),
    ("Mesh_Primitives/Mesh_Primitives_00.gltf", 0),
    ("Mesh_PrimitiveAttribute/Mesh_PrimitiveAttribute_00.gltf", 6),
    ("Mesh_PrimitivesUV/Mesh_PrimitivesUV_00.gltf", 8),
    ("Node_Attribute/Node_Attribute_00.gltf", 8),
    ("TextureSampler/TextureSampler_00.gltf", 13),
];

const ROTATION_FACTOR: f32 = 0.01;
const ZOOM_FACTOR: f32 = 0.1;

static STATE: LazyLock<Mutex<State>> = LazyLock::new(|| Mutex::new(State::default()));

#[derive(Default)]
struct State {
    scene: SceneInfo,
    auto_rotate: bool,
}

#[derive(Default)]
struct SceneInfo {
    scene_index: usize,
    version_index: usize,
    scene_type: SceneType,
}

#[derive(Default)]
enum SceneType {
    #[default]
    Sample,
    Validation(usize),
}

impl SceneInfo {
    fn path(&self) -> Result<String> {
        let path = match self.scene_type {
            SceneType::Sample => SCENE_PATHS
                .get(self.scene_index)
                .map(|p| Path::new(SCENE_ROOT).join(p.to_string())),
            SceneType::Validation(_) => VALIDATION_PATHS
                .get(self.scene_index)
                .map(|(p, _)| p.replace("_00", &format!("_{:02}", self.version_index)))
                .map(|p| Path::new(VALILDATION_ROOT).join(p)),
        };
        println!("Loading scene: {:?}", path);
        path.clone()
            .ok_or_else(|| anyhow::anyhow!("Error loading scene: {:?}", &path))
            .and_then(|p| p.canonicalize().map_err(anyhow::Error::from))
            .map(|p| p.to_string_lossy().into_owned())
    }

    fn next(&mut self) {
        match self.scene_type {
            SceneType::Sample => self.scene_index = self.scene_index + 1 % SCENE_PATHS.len(),
            SceneType::Validation(_) => {
                let max = VALIDATION_PATHS[self.scene_index].1;
                self.scene_type = SceneType::Validation(max);
                self.scene_index = self.scene_index + 1 % VALIDATION_PATHS.len();
                self.version_index = 0;
            }
        };
    }

    fn prev(&mut self) {
        match self.scene_type {
            SceneType::Sample => self.scene_index = self.scene_index - 1 % SCENE_PATHS.len(),
            SceneType::Validation(_) => {
                let max = VALIDATION_PATHS[self.scene_index].1;
                self.scene_type = SceneType::Validation(max);
                self.scene_index = self.scene_index - 1 % VALIDATION_PATHS.len();
                self.version_index = 0;
            }
        };
    }

    fn next_version(&mut self) {
        if let SceneType::Validation(max) = self.scene_type {
            println!("Next version: {}, {}", self.version_index, max);
            self.version_index = (self.version_index + 1) % max;
        }
    }

    fn prev_version(&mut self) {
        if let SceneType::Validation(max) = self.scene_type {
            println!("Next version: {}, {}", self.version_index, max);
            self.version_index = (self.version_index - 1) % max;
        }
    }
}

fn load_scene(state: &State, scene: &mut Scene, assets: &mut Assets) {
    state
        .scene
        .path()
        .and_then(|p| gltf::load_scene(&p, assets))
        .and_then(|desc| scene.load(desc))
        .unwrap_or_else(|e| {
            println!("Error loading scene: {:?}", e);
        });
}

fn init_system(mut scene: ResMut<Scene>, mut assets: ResMut<Assets>) {
    let state = STATE.lock().unwrap();
    load_scene(&state, &mut scene, &mut assets);
}

fn input_system(mut scene: ResMut<Scene>, mut assets: ResMut<Assets>, input: Res<Input>) {
    let mut state = STATE.lock().unwrap();

    if input.key_pressed(&Key::Digit1) {
        state.scene.scene_index = 0;
        state.scene.scene_type = SceneType::Sample;
        load_scene(&state, &mut scene, &mut assets);
    } else if input.key_pressed(&Key::Digit2) {
        state.scene.scene_index = 0;
        state.scene.scene_type = SceneType::Validation(0);
        load_scene(&state, &mut scene, &mut assets);
    }

    if let SceneType::Validation(_) = &state.scene.scene_type {
        if input.key_pressed(&Key::ArrowUp) {
            state.scene.next_version();
            load_scene(&state, &mut scene, &mut assets);
        } else if input.key_pressed(&Key::ArrowDown) {
            state.scene.prev_version();
            load_scene(&state, &mut scene, &mut assets);
        }
    }
    if input.key_pressed(&Key::ArrowLeft) {
        state.scene.prev();
        load_scene(&state, &mut scene, &mut assets);
    } else if input.key_pressed(&Key::ArrowRight) {
        state.scene.next();
        load_scene(&state, &mut scene, &mut assets);
    }

    if input.key_pressed(&Key::KeyR) {
        state.auto_rotate = !state.auto_rotate;
    }

    if input.mouse_button_held(&MouseButton::Right) {
        let delta = input.mouse_delta();
        scene.camera.yaw_delta(delta.0 * ROTATION_FACTOR);
        scene.camera.pitch_delta(delta.1 * ROTATION_FACTOR);
    }

    if let Some(delta) = input.mouse_scroll_delta() {
        scene.camera.zoom(delta.1 * ZOOM_FACTOR);
    }

    if state.auto_rotate {
        scene.nodes_mut().for_each(|node| {
            if let NodeData::Mesh(_) = node.data {
                node.rotate(ROTATION_FACTOR);
            }
        });
    }
}

fn main() {
    let config = AppConfig::default().name("Demo");

    App::new(config)
        .with_system(Schedule::Startup, init_system)
        .with_system(Schedule::Default, input_system)
        .with_layer(RenderLayer::default())
        .run()
        .expect("Error running app");
}
