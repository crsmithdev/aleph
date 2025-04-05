use {
    anyhow::Result,
    shaderc as sc,
    std::{
        env::join_paths,
        fs::{self, DirEntry},
        io::{Read, Write},
        path::{Path, PathBuf},
        process::exit,
    },
};

const SHADER_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/shaders");
const SHADER_EXTENSIONS: &[&str] = &["vert", "frag", "comp", "geom", "tesc", "tese"];

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
    let content = match include_type {
        sc::IncludeType::Relative => fs::read_to_string(name).map_err(|e| e.to_string()),
        sc::IncludeType::Standard => {
            let path = PathBuf::from(SHADER_DIR).join(name);
            fs::read_to_string(&path).map_err(|e| e.to_string())
        }
    }?;

    Ok(sc::ResolvedInclude {
        resolved_name: name.to_string(),
        content,
    })
}

fn compile_shader(path: &Path, output: &Path, kind: sc::ShaderKind) -> Result<()> {
    let compiler = sc::Compiler::new().expect("Failed to create shader compiler");
    let mut options = sc::CompileOptions::new().expect("Failed to create compiler options");

    options.set_generate_debug_info();
    options.set_optimization_level(shaderc::OptimizationLevel::Zero);
    options.set_target_env(sc::TargetEnv::Vulkan, sc::EnvVersion::Vulkan1_3 as u32);
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

// fn compile_shader_opt(entry: &DirEntry) -> ShaderCompileResult {
//     let path = entry.path();

//     if path.is_dir() {
//         return ShaderCompileResult::Skip();
//     }

//     let in_file = match path.to_str() {
//         Some(p) => p,
//         None => return ShaderCompileResult::Error("Failed reading file path".into()),
//     };
//     let extension = match path.extension().and_then(|e| e.to_str()) {
//         Some(e) => e,
//         None => return ShaderCompileResult::Error("Failed reading file extension".into()),
//     };
//     let in_filename = match path.file_name().and_then(|f| f.to_str()) {
//         Some(f) => f.to_string(),
//         None => return ShaderCompileResult::Error("Failed reading filename".into()),
//     };
//     let shader_kind = match extension.as_ref() {
//         "vert" => sc::ShaderKind::Vertex,
//         "frag" => sc::ShaderKind::Fragment,
//         "comp" => sc::ShaderKind::Compute,
//         "geom" => sc::ShaderKind::Geometry,
//         "tesc" => sc::ShaderKind::TessControl,
//         "tese" => sc::ShaderKind::TessEvaluation,
//         _ => {
//             return ShaderCompileResult::Skip();
//         }
//     };
//     let out_filename = format!("shaders/{}.spv", in_filename);

//     match compile_shader(in_file, &out_filename, shader_kind) {
//         Ok(_) => ShaderCompileResult::Ok(in_filename, out_filename),
//         Err(e) => ShaderCompileResult::Error(format!("Failed to compile shader: {e}")),
//     }
// }

fn compile_shaders() -> Result<()> {
    let files = fs::read_dir(SHADER_DIR).map_err(|e| anyhow::anyhow!(e))?;

    for entry in files {
        let entry = entry.map_err(|e| anyhow::anyhow!(e))?;
        let in_path = entry.path();

        if in_path.is_dir() {
            continue;
        }

        let extension = in_path
            .extension()
            .and_then(|e| e.to_str())
            .ok_or(anyhow::anyhow!("Failed to read file extension"))?;

        let shader_kind = match extension.as_ref() {
            "vert" => sc::ShaderKind::Vertex,
            "frag" => sc::ShaderKind::Fragment,
            "comp" => sc::ShaderKind::Compute,
            "geom" => sc::ShaderKind::Geometry,
            "tesc" => sc::ShaderKind::TessControl,
            "tese" => sc::ShaderKind::TessEvaluation,
            _ => continue,
        };
        let filename = in_path
            .file_name()
            .and_then(|f| f.to_str())
            .ok_or(anyhow::anyhow!("Failed to read filename"))?;

        let out_path = Path::new(SHADER_DIR).join(format!("{filename}.spv"));

        compile_shader(&in_path, &out_path, shader_kind)?;
    }

    Ok(())

}

fn main() { match compile_shaders() {
        Ok(_) => println!("Shaders compiled successfully"),
        Err(e) => {
            eprintln!("Error compiling shaders: {e}");
            exit(1);
        }
    };
}
