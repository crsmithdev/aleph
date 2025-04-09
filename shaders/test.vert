#version 450

#extension GL_GOOGLE_include_directive : require
#extension GL_EXT_buffer_reference : require

#include "./include/draw.glsl"
#include "./include/scene.glsl"
#include "./include/material.glsl"

precision highp float;
precision highp int;
precision highp usampler2D;

layout(location = 0) out vec3 outWorldPos;
layout(location = 1) out vec3 outNormal;
layout(location = 2) out vec3 outTangent;
layout(location = 3) out vec2 outUv;
layout(location = 4) out vec3 outColor;
layout(location = 5) out vec3 outBitangent;
layout(location = 6) out vec3 outNormalGen;

struct Vertex {
    vec3 pos;
    float uvX;
    vec3 normal;
    float uvY;
    vec4 tangent;
    vec4 color;
    vec3 normalGen;
};

layout (buffer_reference, std430) readonly buffer VertexBuffer {
    Vertex vertices[];
};

layout ( push_constant ) uniform constants {
    VertexBuffer vertexBuffer;
} Constants;

void main() {
    Vertex v = Constants.vertexBuffer.vertices[gl_VertexIndex];

    vec3 normal = normalize(v.normal);
    vec3 tangent = normalize(v.tangent.xyz);
    vec3 bitangent = cross(normal, tangent) * v.tangent.w;

    outColor = v.color.xyz;
    outNormal = v.normal;
    outUv = vec2(v.uvX, v.uvY);
    outNormalGen = normalize(v.normalGen);
    outWorldPos = vec3(draw.model * vec4(v.pos, 1.0));
    outBitangent = bitangent;
    outTangent = tangent;

    gl_Position = draw.mvp * vec4(v.pos, 1.0);;
}