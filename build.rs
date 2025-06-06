use {
    maplit::hashmap,
    slang::{Downcast as _, GlobalSession, Session},
    std::{collections::HashMap, fs, path::Path, process, sync::LazyLock},
};

const IGNORED: [&str; 1] = ["compiled"];
const INPUT_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "\\shaders");
const OUTPUT_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "\\shaders\\compiled");
static ENTRY_POINTS: LazyLock<HashMap<String, String>> = LazyLock::new(|| {
    hashmap! {
        "vertexMain".to_string() => "vert".to_string(),
        "fragmentMain".to_string() => "frag".to_string(),
    }
});

fn main() {
    fs::create_dir_all(OUTPUT_DIR)
        .unwrap_or_else(|e| panic!("Error creating output directory {}: {}", OUTPUT_DIR, e));

    let shader_files = find_shaders(INPUT_DIR);
    let compiler = ShaderCompiler::new();

    for path in &shader_files {
        compiler.compile(path);
    }

    process::exit(0);
}

struct ShaderCompiler {
    #[allow(dead_code)]
    global_session: GlobalSession,
    session: Session,
}

impl ShaderCompiler {
    fn new() -> Self {
        let global_session =
            GlobalSession::new().unwrap_or_else(|| panic!("Error creating Slang global session"));

        let search_path = std::ffi::CString::new(INPUT_DIR)
            .unwrap_or_else(|e| panic!("Error creating search path CString: {e}"));

        let session_options = slang::CompilerOptions::default()
            .optimization(slang::OptimizationLevel::High)
            .matrix_layout_row(true);

        let targets = [slang::TargetDesc::default()
            .format(slang::CompileTarget::Spirv)
            .profile(global_session.find_profile("glsl_450"))];
        let search_paths = [search_path.as_ptr()];

        let session_desc = slang::SessionDesc::default()
            .targets(&targets)
            .search_paths(&search_paths)
            .options(&session_options);

        let session = global_session.create_session(&session_desc).unwrap_or_else(|| {
            panic!("Error creating Slang session");
        });

        Self {
            global_session,
            session,
        }
    }

    fn compile(&self, input_path: &Path) {
        let module_name = get_filename(input_path);
        let module = self
            .session
            .load_module(module_name)
            .unwrap_or_else(|e| panic!("Failed to load module {module_name}: {e}"));

        let entry_points = ENTRY_POINTS
            .iter()
            .filter(|(k, _)| module.find_entry_point_by_name(k).is_some())
            .collect::<Vec<_>>();

        if entry_points.is_empty() {
            panic!("No entry points found in module: {module_name}");
        }

        for (fn_name, stage) in &entry_points {
            let entry = module
                .find_entry_point_by_name(fn_name)
                .unwrap_or_else(|| panic!("Failed to find entry point: {fn_name}"));

            let program = self
                .session
                .create_composite_component_type(&[
                    module.downcast().clone(),
                    entry.downcast().clone(),
                ])
                .unwrap_or_else(|e| panic!("Error creating composite component type: {e}"));

            let linked = program.link().unwrap_or_else(|e| panic!("Error linking program: {e}"));

            let bytecode = linked
                .entry_point_code(0, 0)
                .unwrap_or_else(|e| panic!("Error generating shader bytecode: {e}"));

            let out_path =
                Path::new(OUTPUT_DIR).join(format!("{}.{}.spv", get_basename(input_path), stage));
            fs::write(&out_path, bytecode.as_slice())
                .unwrap_or_else(|e| panic!("Error writing output file {out_path:?}: {e}"));

            println!(
                "Compiled {} -> {} ({})",
                input_path.display(),
                out_path.display(),
                fn_name
            );
        }
    }
}

fn get_extension(path: &Path) -> &str {
    path.extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_else(|| panic!("Error reading file extension for {path:?}"))
}

fn get_filename(path: &Path) -> &str {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_else(|| panic!("Error reading file name for {path:?}"))
}

fn get_basename(path: &Path) -> &str {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or_else(|| panic!("Error reading file stem for {path:?}"))
}

fn find_shaders(dir: &str) -> Vec<std::path::PathBuf> {
    let mut files = Vec::new();
    let mut remaining_dirs = vec![std::path::PathBuf::from(dir)];

    while let Some(dir) = remaining_dirs.pop() {
        let dirname = get_filename(&dir);

        // Skip ignored directories
        if IGNORED.contains(&get_basename(&dir)) {
            continue;
        }

        let entries =
            fs::read_dir(&dir).unwrap_or_else(|e| panic!("Error reading directory {dir:?}: {e}"));

        for entry in entries {
            let entry = entry.unwrap_or_else(|e| panic!("Error reading directory entry: {e}"));
            let path = entry.path();
            let filename = get_filename(&path);

            if path.is_dir() {
                println!("Including directory: {dirname}");
                remaining_dirs.push(path);
            } else if get_extension(&path) == "slang" {
                println!("Including shader: {filename}");
                files.push(path);
            }
        }
    }

    files
}
