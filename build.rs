use {
    anyhow::Result,
    shaderc as sc,
    std::{
        fs,
        io::{Read, Write},
        path::{Path, PathBuf},
        process::exit,
    },
    tracing::{debug, error, info, instrument, warn},
};

const SHADER_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/shaders");

fn read_file(path: &Path) -> String {
    let mut out = String::new();
    fs::File::open(path).unwrap().read_to_string(&mut out).unwrap();
    out
}

fn write_file(path: &Path, binary: &[u8]) {
    fs::File::create(path).unwrap().write_all(binary).unwrap();
}

fn resolve_include(
    name: &str,
    include_type: shaderc::IncludeType,
    _src: &str,
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

#[instrument(skip(path, output), fields(shader = %path.display(), output = %output.display()))]
fn compile_shader(path: &Path, output: &Path, kind: sc::ShaderKind) -> Result<()> {
    let compiler = sc::Compiler::new().expect("Failed to create shader compiler");
    let mut options = sc::CompileOptions::new().expect("Failed to create compiler options");

    options.set_generate_debug_info();
    options.set_optimization_level(shaderc::OptimizationLevel::Zero);
    options.set_target_env(sc::TargetEnv::Vulkan, sc::EnvVersion::Vulkan1_3 as u32);
    options.set_include_callback(resolve_include);

    let source_content = read_file(path);
    let binary = compiler
        .compile_into_spirv(
            &source_content,
            kind,
            path.as_os_str().to_str().unwrap(),
            "main",
            Some(&options),
        )
        .map_err(|e| {
            error!("Shader compilation failed for {}: {}", path.display(), e);
            anyhow::anyhow!(e)
        })?;

    // Check if output changed to avoid unnecessary rebuilds
    if output.exists() {
        let existing = fs::read(output).unwrap_or_default();
        if existing == binary.as_binary_u8() {
            debug!("Shader unchanged: {}", output.display());
            return Ok(());
        }
    }

    write_file(output, binary.as_binary_u8());
    info!(
        "Compiled shader: {} -> {}",
        path.display(),
        output.display()
    );

    Ok(())
}

#[instrument]
fn compile_shaders() -> Result<()> {
    let files = fs::read_dir(SHADER_DIR).map_err(|e| anyhow::anyhow!(e))?;
    let mut compiled_count = 0;
    let skipped_count = 0;

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

        let shader_kind = match extension {
            "vert" => sc::ShaderKind::Vertex,
            "frag" => sc::ShaderKind::Fragment,
            "comp" => sc::ShaderKind::Compute,
            "geom" => sc::ShaderKind::Geometry,
            "tesc" => sc::ShaderKind::TessControl,
            "tese" => sc::ShaderKind::TessEvaluation,
            _ => {
                debug!("Skipping non-shader file: {}", in_path.display());
                continue;
            }
        };

        let filename = in_path
            .file_name()
            .and_then(|f| f.to_str())
            .ok_or(anyhow::anyhow!("Failed to read filename"))?;

        let out_path = Path::new(SHADER_DIR).join(format!("{filename}.spv"));

        match compile_shader(&in_path, &out_path, shader_kind) {
            Ok(_) => compiled_count += 1,
            Err(e) => {
                error!("Failed to compile shader {}: {}", in_path.display(), e);
                return Err(e);
            }
        }
    }

    info!(
        "Shader compilation complete: {} compiled, {} skipped",
        compiled_count, skipped_count
    );
    Ok(())
}

fn main() {
    println!("{}", SHADER_DIR);
    match compile_shaders() {
        Ok(_) => println!("Shaders compiled successfully"),
        Err(e) => {
            eprintln!("Error compiling shaders: {e}");
            exit(1);
        }
    };
}
