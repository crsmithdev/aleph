#version 450

#extension GL_GOOGLE_include_directive : require
#extension GL_EXT_buffer_reference : require

// #include "./include/draw.glsl"
// #include "./include/scene.glsl"
// #include "./include/material.glsl"

precision highp float;
precision highp int;
precision highp usampler2D;

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

layout(location = 0) in vec3 inPos;
layout(location = 1) in float inUVx;
layout(location = 2) in vec3 inNormal;
layout(location = 3) in float inUVy;
layout(location = 4) in vec4 inTangent;
layout(location = 5) in vec4 inColor;
layout(location = 6) in vec3 inNormalGen;

layout (location = 0) out vec4 outPos;
layout (location = 1) out vec3 outNormal;
layout (location = 2) out vec2 outUv;
layout (location = 3) out vec4 outColor;
layout (location = 4) out vec3 outTangent;
layout (location = 5) out vec3 outBitangent;
layout (location = 6) out vec3 outNormalGen;
layout (location = 7) out vec4 outWorldPos;

void main() {
    vec3 normal = normalize(inNormal);
    vec3 tangent = normalize(inTangent.xyz);
    vec3 bitangent = cross(normal, tangent) * inTangent.w;

    outColor = inColor;
    outNormal = inNormal;
    outUv = vec2(inUVx, inUVy);
    outNormalGen = normalize(inNormalGen);
    outPos = draw.model_view_projection * vec4(inPos, 1.0);;
    outBitangent = bitangent;
    outTangent = tangent;
    outWorldPos = draw.model * vec4(inPos, 1.0);;

    gl_Position = draw.model_view_projection * vec4(inPos, 1.0);;
}