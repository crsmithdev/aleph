
#version 450

#extension GL_GOOGLE_include_directive : require
#extension GL_EXT_debug_printf : enable
layout (std140, binding = 0) uniform GpuDrawData {
    mat4 model;
    mat4 view;
    mat4 projection;
    mat4 model_view;
    mat4 view_projection;
    mat4 model_view_projection; 
    mat4 world_transform;
    mat4 view_inverse;
    mat4 model_view_inverse;
    mat4 normal;
    vec3 camera_pos;
    float _padding;
} draw;

layout (std140, binding = 1) uniform GpuMaterialData {
    vec4 color_factor;
    float metal_factor;
    float rough_factor;
    float occlusion_strength;
    vec2 _padding;
} material;

layout (set = 0, binding = 2) uniform sampler2D color_map;
layout (set = 0, binding = 3) uniform sampler2D normal_map;
layout (set = 0, binding = 4) uniform sampler2D metal_rough_map;
layout (set = 0, binding = 5) uniform sampler2D occlusion_map;  
layout (location = 0) in vec3 in_pos;
layout (location = 1) in float in_uvx;
layout (location = 2) in vec3 in_normal;
layout (location = 3) in float in_uvy;
layout (location = 4) in vec4 in_tangent;
layout (location = 5) in vec4 in_color;
layout (location = 6) in vec4 in_normal_derived;

layout (location = 1) out vec3 out_pos;
layout (location = 2) out vec3 out_normal;
layout (location = 3) out vec3 out_normal_derived;
layout (location = 4) out vec2 out_uv;
layout (location = 5) out vec3 out_color;

void main () {
    out_pos = vec3(draw.model * vec4(in_pos, 1.0));
	out_normal = in_normal;
	out_normal_derived = in_normal_derived.xyz;
	out_uv = vec2(in_uvx, in_uvy);
	out_color = in_color.xyz; 
    gl_Position = draw.model_view_projection * vec4(in_pos, 1.0);
}