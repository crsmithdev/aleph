#version 450

#extension GL_GOOGLE_include_directive : require
#extension GL_EXT_debug_printf : enable
#include "./util.glsl"
#include "./forward.glsl"

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