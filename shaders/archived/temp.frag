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

layout(set = 0, binding = 2) uniform sampler2D color_map;
layout(set = 0, binding = 3) uniform sampler2D normal_map;
layout(set = 0, binding = 4) uniform sampler2D metal_rough_map;
layout(set = 0, binding = 5) uniform sampler2D occlusion_map;  

layout (location = 0) in vec3 in_normal;
layout (location = 1) in vec3 in_color;
layout (location = 2) in vec3 in_view;
layout (location = 3) in vec3 in_light;

layout (location = 0) out vec4 out_color;

void main() 
{
	vec3 N = normalize(in_normal);
	vec3 L = normalize(in_light);
	vec3 V = normalize(in_view);
	vec3 R = reflect(-L, N);
	vec3 ambient = vec3(0.1);
	vec3 diffuse = max(dot(N, L), 0.0) * vec3(1.0);
	vec3 specular = pow(max(dot(R, V), 0.0), 16.0) * vec3(0.75);
	out_color = vec4((ambient + diffuse) * in_color.rgb + specular, 1.0);		
}