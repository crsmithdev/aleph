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
    // vec3 locPos = vec3(ubo.model * vec4(inPos, 1.0));
	// outWorldPos = locPos;
	// outNormal = mat3(ubo.model) * inNormal;
	// outTangent = vec4(mat3(ubo.model) * inTangent.xyz, inTangent.w);
	// outUV = inUV;
	// gl_Position =  ubo.projection * ubo.view * vec4(outWorldPos, 1.0);

    vec3 pos = vec3(u_draw.model * vec4(inPos, 1.0));
    outNormal = mat3(u_draw.model) * inNormal;
	outTangent = vec4(mat3(u_draw.model) * inTangent.xyz, inTangent.w);
    outUv = vec2(inUVx, inUVy);
    outColor = inColor;
    outPos = pos;

    gl_Position = u_scene.projection * u_scene.view * vec4(outPos, 1.0);

    // vec4 position = vec4(inPos, 1.0);
    // vec4 normal = vec4(inNormal, 0.0);

    // vec3 T = normalize(vec3(u_draw.model * vec4(inTangent.xyz, 0.0)).xyz );
    // vec3 N = normalize(vec3(u_draw.model * normal));
    // vec3 B = normalize(vec3(u_draw.model * vec4( (cross(inTangent.xyz, inNormal) * inTangent.w), 0.0 )).xyz );

    // outTBN = mat3(T, B, N);
    // outNormal = inNormal;
    // outUv = vec2(inUVx, inUVy);
    // outPos = (u_draw.model * position).xyz;

    // gl_Position = u_scene.projection * u_scene.view * outPos;
}
// void main() {
//     vec3 normal = normalize(inNormal);
//     vec3 tangent = normalize(inTangent.xyz);
//     vec3 bitangent = cross(normal, tangent) * inTangent.w;
//     vec4 pos = vec4(inPos, 1.0);

//     outColor = inColor;
//     outNormal = inNormal;
//     outUv = vec2(inUVx, inUVy);
//     outNormalGen = inNormalGen;
//     outPos = (draw.model * pos).xyz;
//     outBitangent = bitangent;
//     outTangent = tangent;

//     gl_Position = draw.model_view_projection * vec4(inPos, 1.0);;
// }