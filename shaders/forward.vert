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
layout (location = 2) out vec4 outTangent;
layout (location = 3) out vec2 outUv;
layout (location = 4) out vec4 outColor;
layout (location = 5) out mat3 outTBN;

void main() {
    outPos = vec3(u_draw.model * vec4(inPos, 1.0));;
    outNormal = mat3(u_draw.model) * inNormal;
	outTangent = vec4(mat3(u_draw.model) * inTangent.xyz, inTangent.w);
    outUv = vec2(inUVx, inUVy);
    outColor = inColor;

    gl_Position = u_scene.projection * u_scene.view * vec4(outPos, 1.0);
}