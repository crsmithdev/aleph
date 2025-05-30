# Aleph Repository Instructions

## Project Overview
Aleph is a Rust-based graphics engine with Vulkan backend.  The project is structured into multiple crates, each handling different aspects of the engine. 

## Code Style Guidelines
- Use the minimal amount of code needed to be functional without sacrificing clarity.
- Use the shortest possible variable and other names that are still readable.
- Avoid introducing lifetimes where possible, preferring other options instead.
- Pefer writing a small number of tests that cover a wide range of cases, rather than many tests that cover only a few cases each.
- Do not delete structures, methods or functions, even if unused, without asking me first.
- Make changes incrementally (e.g. go file by file, wait for confirmation before moving on)
- Make changes alongside existing code, with temporary naming where needed.
- Avoid making 1-2 line functions that are only used once or in a small number of places.
- The code should visually look neat and pleasant.


## Project Guidelines
- Re-export commonly-used Vulkan types from `aleph-vk`
- Use `anyhow` for error handling
- Use `tracing` for logging with structured output
- Use bevy-style dependency injection for passing around resources
- Gate test using a GPU with a `gpu-tests` feature flag