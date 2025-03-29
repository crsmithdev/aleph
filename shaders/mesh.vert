#version 450

#extension GL_GOOGLE_include_directive : require
#extension GL_EXT_debug_printf : enable
#include "./util.glsl"
#include "./forward.glsl"

layout(location = 0) in vec3 in_pos;
layout(location = 1) in float in_uvx;
layout(location = 2) in vec3 in_normal;
layout(location = 3) in float in_uvy;
layout(location = 4) in vec4 in_tangent;
layout(location = 5) in vec4 in_color;
layout(location = 6) in vec3 in_normal_derived;

layout (location = 0) out vec4 out_world_pos;
layout (location = 1) out vec3 out_normal;
layout (location = 2) out vec2 out_uv;
layout (location = 3) out vec4 out_color;
layout (location = 4) out vec3 out_tangent;
layout (location = 5) out vec3 out_bitangent;
layout (location = 6) out mat3 out_tbn; 
layout (location = 7) out vec3 out_normal_derived;

void main()  
{
//     vec3 normal = normalize(draw.model_view * vec4(in_normal, 0.0)).xyz;
//     vec4 tangent = normalize(draw.model_view * in_tangent);
//     vec3 bitangent = cross( in_normal, in_tangent.xyz ) * in_tangent.w;
//     mat3 tbn = mat3(tangent, bitangent, normal);

    vec3 normal_derived = normalize(in_normal_derived);
    vec3 normal = normalize(in_normal);
    vec3 tangent = normalize(vec3(draw.model_view_projection * vec4(in_tangent.xyz, 0.0)));
    vec3 bitangent = cross(normal, tangent) * in_tangent.w;
    mat3 tbn = mat3(tangent, bitangent, normal);


    out_normal_derived = normal_derived;
    out_normal = normal;

    #ifdef DEBUG_VERTEX
        //debugPrintfEXT("normal: %f %f %f\n", normal.x, normal.y, normal.z);
        // debugPrintfEXT("tangent: %f %f %f\n", tangent.x, tangent.y, tangent.z);
        // debugPrintfEXT("bitangent: %f %f %f\n", bitangent.x, bitangent.y, bitangent.z);
    #endif

    out_uv = vec2(in_uvx, in_uvy);
    out_color = in_color; 
    out_tangent = tangent;
    out_bitangent = bitangent;
    out_tbn = tbn;

    gl_Position = draw.projection * draw.view * draw.model * vec4(in_pos, 1.0);  
}
