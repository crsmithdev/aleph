use {
    anyhow::Result,
    shaderc as sc,
    std::{
        fs::{self, DirEntry},
        io::{Read, Write},
        path::Path,
        process::exit,
    },
};

fn read_file(path: &Path) -> String {
    let mut out = String::new();
    fs::File::open(path)
        .unwrap()
        .read_to_string(&mut out)
        .unwrap();
    out
}

fn write_file(path: &Path, binary: &[u8]) {
    fs::File::create(path).unwrap().write_all(binary).unwrap();
}

fn resolve_include(
    name: &str,
    include_type: shaderc::IncludeType,
    src: &str,
    _depth: usize,
) -> std::result::Result<shaderc::ResolvedInclude, String> {
    let include_path = match include_type {
        sc::IncludeType::Relative => Path::new(src).parent().and_then(|p| Some(p.join(name))),
        sc::IncludeType::Standard => unimplemented!(),
    };

    match include_path {
        Some(path) => {
            let path_str = path.clone();
            let path_str = path_str.to_string_lossy();
            match std::fs::read_to_string(path) {
                Ok(content) => {
                    let incl = sc::ResolvedInclude {
                        resolved_name: path_str.into(),
                        content,
                    };
                    Ok(incl)
                }
                Err(e) => Err(format!("Could not open file {}", e)),
            }
        }
        None => {
            todo!();
        }
    }
}

fn compile_shader(path: &str, output: &str, kind: sc::ShaderKind) -> Result<()> {
    let compiler = sc::Compiler::new().expect("Failed to create shader compiler");
    let mut options = sc::CompileOptions::new().expect("Failed to create compiler options");

    options.set_generate_debug_info();
    options.set_target_env(sc::TargetEnv::Vulkan, sc::EnvVersion::Vulkan1_2 as u32);
    options.set_include_callback(resolve_include);

    let in_path = Path::new(path);
    let out_path = Path::new(output);
    let binary = compiler
        .compile_into_spirv(
            &read_file(in_path),
            kind,
            in_path.as_os_str().to_str().unwrap(),
            "main",
            Some(&options),
        )
        .map_err(|e| anyhow::anyhow!(e))?;
    write_file(out_path, binary.as_binary_u8());

    Ok(())
}

fn compile_shader_opt(entry: &DirEntry) -> ShaderCompileResult {
    let path = entry.path();
    let in_file = match path.to_str() {
        Some(p) => p,
        None => return ShaderCompileResult::Error("Failed reading file path".into()),
    };
    let extension = match path.extension().and_then(|e| e.to_str()) {
        Some(e) => e,
        None => return ShaderCompileResult::Error("Failed reading file extension".into()),
    };
    let in_filename = match path.file_name().and_then(|f| f.to_str()) {
        Some(f) => f.to_string(),
        None => return ShaderCompileResult::Error("Failed reading filename".into()),
    };
    let shader_kind = match extension.as_ref() {
        "vert" => sc::ShaderKind::Vertex,
        "frag" => sc::ShaderKind::Fragment,
        "comp" => sc::ShaderKind::Compute,
        "geom" => sc::ShaderKind::Geometry,
        "tesc" => sc::ShaderKind::TessControl,
        "tese" => sc::ShaderKind::TessEvaluation,
        _ => {
            return ShaderCompileResult::Skip();
        }
    };
    let out_filename = format!("shaders/{}.spv", in_filename);

    match compile_shader(in_file, &out_filename, shader_kind) {
        Ok(_) => ShaderCompileResult::Ok(in_filename, out_filename),
        Err(e) => ShaderCompileResult::Error(format!("Failed to compile shader: {e}")),
    }
}

enum ShaderCompileResult {
    Ok(String, String),
    Error(String),
    Skip(),
}

fn compile_shaders(path: &str) {
    let files = std::fs::read_dir(path).unwrap_or_else(|e| {
        eprintln!("Failed to read directory {path}: {e}");
        exit(1);
    });

    for entry in files {
        match compile_shader_opt(&entry.unwrap()) {
            ShaderCompileResult::Ok(file, out) => println!("Compiled shader {file} -> {out}"),
            ShaderCompileResult::Error(e) => eprintln!("Failed to compile shader: {e}"),
            ShaderCompileResult::Skip() => ()
        }
    }
}

fn main() { compile_shaders("shaders/"); }
