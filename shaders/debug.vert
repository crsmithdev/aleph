#version 450

#extension GL_GOOGLE_include_directive : require
#extension GL_EXT_buffer_reference : require

#pragma shader_stage(vertex)
precision highp float;
precision highp int;
precision highp usampler2D;

#include "./include/scene.glsl"
#include "./include/draw.glsl"
#include "./include/vertex.glsl"

layout (location = 0) out vec3 outPos;
layout (location = 1) out vec3 outNormal;

void main()
{
vec4 position = vec4(inPos, 1.0);
    vec4 normal = vec4(inNormal, 1.0);

    gl_Position = u_scene.projection * u_scene.view * u_draw.model * position;

    outNormal = (u_draw.model * normal).xyz;
    outPos = (u_draw.model * position).xyz;
}