#version 450

#extension GL_EXT_debug_printf : enable

layout (std140, binding = 0) uniform GpuGlobalData {
	mat4 view;
	mat4 projection;
	mat4 view_projection;
	vec4 ambient_color;
	vec4 sunlight_directionL;
	vec4 sunlight_color;
} global_data;

layout (std140, binding = 1) uniform GpuModelData {
	mat4 model_matrix;
	mat4 mvp_matrix;
} model_data;

layout (location = 0) in vec3 inColor;

layout (location = 0) out vec4 outFragColor;

void main() 
{
	outFragColor = vec4(inColor,1.0f);
}