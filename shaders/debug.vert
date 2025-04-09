#version 450

#pragma shader_stage(vertex)

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

layout(set = 0, binding = 2) uniform sampler2D color_map;
layout(set = 0, binding = 3) uniform sampler2D normal_map;
layout(set = 0, binding = 4) uniform sampler2D metal_rough_map;
layout(set = 0, binding = 5) uniform sampler2D occlusion_map;  

layout(location = 0) in vec3 in_pos;
layout(location = 2) in vec3 in_normal;
layout (location = 6) in vec3 normal_derived;

layout(location = 0) out vec3 out_pos;
layout(location = 1) out vec3 out_normal;

void main()
{
    out_normal = in_normal;
    gl_Position =  vec4(in_pos, 1.0);  
}