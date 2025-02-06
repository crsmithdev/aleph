#version 450

#extension GL_EXT_debug_printf : enable

layout (std140, binding = 0) uniform GpuGlobalData {
	vec4 test_value;
} global_data;

void main() 
{
}