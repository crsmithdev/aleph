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


layout (location = 0) in vec3 in_normal;
layout (location = 1) in vec2 in_tex_coords;
layout (location = 2) in vec3 in_frag_position;

layout (location = 0) out vec4 frag_color;

void main()
{	vec3 lightPos = vec3(1.0, 1.0, 1.0);
    vec3 lightColor = vec3(1.0, 1.0, 1.0);
    vec3 objectColor = vec3(1.0, 1.0, 1.0);
    float ambientStrength = 0.1;

    vec3 ambient = ambientStrength * lightColor;

    vec3 norm = normalize(in_normal);
    vec3 lightDir = normalize(lightPos - in_frag_position);  
    float diff = max(dot(norm, lightDir), 0.0);
    vec3 diffuse = diff * lightColor;
    vec3 result = (ambient + diffuse) * objectColor;

    frag_color = vec4(result, 1.0);
}