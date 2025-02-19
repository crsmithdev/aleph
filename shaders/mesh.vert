#version 450

#extension GL_EXT_debug_printf : enable
precision highp float;

layout (std140, binding = 0) uniform GpuSceneData {
	mat4 view;
    mat4 projection;
    mat4 view_projection;
    vec3 lights[4];
    vec3 camera_position;
    float _padding1;
} scene;

layout (std140, binding = 1) uniform GpuMaterialData {
    vec4 albedo;
    float _padding;
    float metallic;
    float roughness;
    float ao;
} material;

layout (std140, binding = 2) uniform GpuDrawData {
    mat4 model;
    mat4 model_view;
    mat4 model_view_projection;
    mat3 normal;
    vec3 position;
} draw;

layout(location = 0) in vec3 in_position;
layout(location = 1) in vec3 in_normal;
layout(location = 2) in vec2 in_uv;

layout (location = 0) out vec3 out_normal;
layout (location = 1) out vec2 out_tex_coords;
layout (location = 2) out vec3 out_world_position;

void main()
{
  gl_Position = draw.model_view_projection * vec4(in_position, 1.0);
  out_world_position = vec3(draw.model * vec4(in_position, 1.0));
  out_normal = mat3(transpose(inverse(draw.model))) * in_normal;
}
