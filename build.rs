use {anyhow::Result, slang::Downcast as _, std::fs};

const INPUT_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "\\shaders");
const OUTPUT_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "\\shaders\\compiled");

fn get_files(dir: &str) -> Result<Vec<std::path::PathBuf>> {
    let mut files = Vec::new();
    let mut dirs = vec![std::path::PathBuf::from(dir)];

    while !dirs.is_empty() {
        let dir = dirs.pop().unwrap();

        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                dirs.push(path);
            } else {
                let extension = path.extension().and_then(|e| e.to_str());
                if let Some("slang") = extension {
                    println!("{:?}", path);
                    files.push(path);
                }
            }
        }
    }
    Ok(files)
}
fn compile_shaders(input: &str, output: &str) {
    println!("?{} -> {}", input, output);
    let global_session = slang::GlobalSession::new().unwrap();

    let search_path = std::ffi::CString::new(INPUT_DIR).unwrap();

    let session_options = slang::CompilerOptions::default()
        .optimization(slang::OptimizationLevel::High)
        .matrix_layout_row(true);

    let target_desc = slang::TargetDesc::default()
        .format(slang::CompileTarget::Spirv)
        .profile(global_session.find_profile("glsl_450"));

    let targets = [target_desc];
    let search_paths = [search_path.as_ptr()];

    let session_desc = slang::SessionDesc::default()
        .targets(&targets)
        .search_paths(&search_paths)
        .options(&session_options);

    let session = global_session.create_session(&session_desc).unwrap();
    let module = session.load_module("test").unwrap();
    let entry_point = module.find_entry_point_by_name("computeMain").unwrap();

    let program = session
        .create_composite_component_type(&[
            module.downcast().clone(),
            entry_point.downcast().clone(),
        ])
        .unwrap();

    let linked_program = program.link().unwrap();

    let shader_bytecode = linked_program.entry_point_code(0, 0).unwrap();

    fs::write(output, shader_bytecode.as_slice()).unwrap();
    println!("!{} -> {}", input, output);
}

fn main() {
    let shaders = get_files(INPUT_DIR).expect("Failed to get shader files");
    for file in shaders {
        let input = file.to_string_lossy();
        let output = file.file_name().expect("Failed to get file name").to_string_lossy();
        let output = format!("{}\\{}", OUTPUT_DIR, output);
        compile_shaders(&input, &output);
    }
}
