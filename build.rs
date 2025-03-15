use glob::glob;
use std::fs;
use std::path::Path;
use shaderc as sc;
use std::io::Read;
use std::io::Write;

const SHADER_PATH: &str = "shaders/*.glsl";

fn load_file(path: &Path) -> String {
    let mut out = String::new();
    fs::File::open(path).unwrap().read_to_string(&mut out).unwrap();
    out
}

fn save_file(path: &Path, binary: &[u8]) {
    fs::File::create(path).unwrap().write_all(binary).unwrap();
}

fn compile_shader(path: &str, kind: sc::ShaderKind, output: &str) {
    let path = Path::new(path);
    let output = Path::new(output);
    let compiler = shaderc::Compiler::new().unwrap();
    let mut options = sc::CompileOptions::new().unwrap();
    options.set_target_env(sc::TargetEnv::Vulkan, sc::EnvVersion::Vulkan1_2 as u32);
    let binary = compiler
        .compile_into_spirv(
            &load_file(path),
            kind,
            path.as_os_str().to_str().unwrap(),
            "main",
            Some(&options),
            
        )
        .unwrap();
    save_file(output, binary.as_binary_u8());
}

fn main() {
    compile_shader("shaders/mesh.frag", sc::ShaderKind::Fragment, "shaders/mesh.frag.spv");
    compile_shader("shaders/mesh.vert", sc::ShaderKind::Vertex, "shaders/mesh.vert.spv");
}