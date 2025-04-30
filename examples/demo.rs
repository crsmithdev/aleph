use {
    aleph::prelude::*,
    aleph_core::{
        input::{Input, Key, MouseButton},
        log,
        system::{Res, ResMut, Schedule},
    },
    aleph_scene::{assets::Assets, gltf, primitives, Node, NodeType, Scene},
    std::sync::{LazyLock, Mutex},
};

static SCENE_PATHS: &[&str] = &[
    "submodules/glTF-Sample-Assets/Models/**/*.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/**/*.gltf",
];
const DEFAULT_SCENE: usize = 25;

const SHIFT_FACTOR: usize = 10;
const ROTATION_FACTOR: f32 = 0.01;
const ZOOM_FACTOR: f32 = 0.1;

static STATE: LazyLock<Mutex<State>> = LazyLock::new(|| Mutex::new(State::default()));

#[derive(Default)]
struct State {
    scene_index: usize,
    scene_paths: Vec<String>,
    auto_rotate: bool,
}

fn load_scene(state: &State, scene: &mut Scene, assets: &mut Assets) {
    let path = &state.scene_paths[state.scene_index];
    let loaded = match gltf::load_scene(path, assets) {
        Ok(loaded) => loaded,
        Err(err) => {
            println!("Failed to load scene from {}: {}", path, err);
            Scene::default()
        }
    };
    *scene = loaded;
}

fn init_system(mut scene: ResMut<Scene>, mut assets: ResMut<Assets>) {
    let mut state = STATE.lock().unwrap();
    state.scene_index = DEFAULT_SCENE;
    glob_files(&mut state);
    load_scene(&state, &mut scene, &mut assets);

    // let x_axis = primitives::cube(5.0, 0.2, 0.2, [1.0, 0.0, 0.0, 1.0]);
    // let x_handle = assets.add_mesh(x_axis).unwrap();
    // let x_node = Node::new("cylinder", NodeType::Mesh(x_handle));
    // let y_axis = primitives::cube(0.2, 5.0, 0.2, [0.0, 1.0, 0.0, 1.0]);
    // let y_handle = assets.add_mesh(y_axis).unwrap();
    // let y_node = Node::new("cylinder", NodeType::Mesh(y_handle));
    // let z_axis = primitives::cube(0.2, 0.2, 5.0, [0.0, 0.0, 1.0, 1.0]);
    // let z_handle = assets.add_mesh(z_axis).unwrap();
    // let z_node = Node::new("cylinder", NodeType::Mesh(z_handle));

    let x_cube = primitives::cube(1.0, 1.0, 1.0, [1.0, 1.0, 1.0, 1.0]);
    let x_handle = assets.add_mesh(x_cube).unwrap();
    let mut x_cube_node = Node::new("cube", NodeType::Mesh(x_handle));
    x_cube_node.transform = glam::Mat4::from_translation(glam::Vec3::new(-5.0, 0.0, 0.0));

    let y_cube = primitives::cube(1.0, 1.0, 1.0, [1.0, 1.0, 1.0, 1.0]);
    let y_handle = assets.add_mesh(y_cube).unwrap();
    let mut y_cube_node = Node::new("cube", NodeType::Mesh(y_handle));
    y_cube_node.transform = glam::Mat4::from_translation(glam::Vec3::new(0.0, 4.0, 0.0));

    let z_cube = primitives::cube(1.0, 1.0, 1.0, [1.0, 1.0, 1.0, 1.0]);
    let z_handle = assets.add_mesh(z_cube).unwrap();
    let mut z_cube_node = Node::new("cube", NodeType::Mesh(z_handle));
    z_cube_node.transform = glam::Mat4::from_translation(glam::Vec3::new(0.0, 0.0, 3.0));

    // scene.attach_root(x_node).unwrap();
    // scene.attach_root(y_node).unwrap();
    // scene.attach_root(z_node).unwrap();
    scene.attach_root(x_cube_node).unwrap();
    scene.attach_root(y_cube_node).unwrap();
    scene.attach_root(z_cube_node).unwrap();
}

fn glob_files(state: &mut State) {
    state.scene_paths = SCENE_PATHS
        .iter()
        .flat_map(|p| {
            glob::glob(p)
                .expect("Failed to read glob")
                .filter_map(|entry| entry.ok())
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
        })
        .collect();

    log::info!("Found {} scene files", state.scene_paths.len());
    for (i, path) in state.scene_paths.iter().enumerate() {
        log::info!("  {} -> {}", i, path);
    }
}

fn input_system(mut scene: ResMut<Scene>, mut assets: ResMut<Assets>, input: Res<Input>) {
    let mut state = STATE.lock().unwrap();
    let n = input.key_pressed(&Key::ShiftLeft) as usize * SHIFT_FACTOR;

    if input.key_pressed(&Key::ArrowLeft) {
        state.scene_index = state.scene_index - n % state.scene_paths.len();
        load_scene(&state, &mut scene, &mut assets);
    } else if input.key_pressed(&Key::ArrowRight) {
        state.scene_index = state.scene_index + n % state.scene_paths.len();
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
            if let NodeType::Mesh(_) = node.data {
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
