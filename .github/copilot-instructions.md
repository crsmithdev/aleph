# Aleph Repository Instructions

## Project Overview
Aleph is a Rust-based graphics engine with Vulkan backend.  The project is structured into multiple crates, each handling different aspects of the engine. 

## Code Style Guidelines
- Use the minimal amount of code needed without sacrificing clarity, avoid verbose code.
- Use terse but readable variable and function names, not overly long or complex ones.
- Avoid introducing lifetimes where possible, preferring other options instead.
- When writing tests, prefer a small number of tests that cover a wide range of cases, rather than many tests that cover only a few cases each.
- Follow SOLID principles, especially the Single Responsibility Principle (SRP).

## Project Guidelines

- Re-export commonly-used Vulkan types from `aleph-vk`
- Use `anyhow` for error handling
- Use `tracing` for logging with structured output
- Use bevy-style dependency injection for passing around resources
- Gate test using a GPU with a `gpu-tests` feature flag