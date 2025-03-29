#version 450

#extension GL_GOOGLE_include_directive : require
#extension GL_EXT_debug_printf : enable
#include "./util.glsl"
#include "./forward.glsl"

layout (location = 0) in vec3 in_pos;
layout (location = 1) in vec3 in_normal;
layout (location = 3) in vec3 in_color;

layout (location = 0) out vec3 out_normal;
layout (location = 1) out vec3 out_color;
layout (location = 2) out vec3 out_view;
layout (location = 3) out vec3 out_light;

void main() 
{
	out_color = in_color;
    gl_Position = draw.projection * draw.view * draw.model * vec4(in_pos, 1.0);
    // vec4 x = draw.projection * draw.view * draw.model * vec4(in_pos, 1.0);

	vec4 pos = draw.model * vec4(in_pos, 1.0);
	// out_normal = mat3(draw.model) * in_normal;
	out_normal = (draw.projection * draw.view * draw.model * vec4(in_normal, 0.0)).xyz;

	vec3 light_pos = vec3(1.0f, 1.0f, 1.0f);
	out_light = light_pos.xyz - in_pos.xyz;
	out_view = -in_pos.xyz;		
}