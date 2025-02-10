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

layout(location = 0) in vec3 position;
layout(location = 1) in float uv_x;
layout(location = 2) in vec3 normal;
layout(location = 3) in float uv_y;
layout(location = 4) in vec4 color;

layout (location = 0) out vec3 outColor;
layout (location = 1) out vec2 outUV;

const vec2 kGeometry[] = vec2[](
    vec2(-1, -1), vec2(1, -1), vec2(1, 1),
    vec2(1,1), vec2(-1, 1), vec2(-1, -1)
);

const vec4 kColor[] = vec4[](
    vec4(1, 0, 0, 1), vec4(0, 1, 0, 1), vec4(0, 0, 1, 1),
    vec4(1, 0, 1, 1), vec4(1, 1, 0, 1), vec4(0, 1, 1, 1)
);

void main() 
{
    gl_Position = model_data.mvp_matrix * vec4(position, 1.0f);
    outNormal = (PushConstants.render_matrix * vec4(v.normal, 0.f)).xyz;
	outColor = color.xyz;
	outUV.x = uv_x;
	outUV.y = uv_y;
}