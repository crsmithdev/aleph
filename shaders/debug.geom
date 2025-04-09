#version 450

#extension GL_GOOGLE_include_directive : require
#extension GL_ARB_shading_language_include : enable
#extension GL_EXT_debug_printf : enable

layout (std140, binding = 0) uniform GpuDrawData {
    mat4 model;
    mat4 view;
    mat4 projection;
    mat4 model_view;
    mat4 view_projection;
    mat4 model_view_projection; 
    mat4 world_transform;
    mat4 view_inverse;
    mat4 model_view_inverse;
    mat4 normal;
    vec3 camera_pos;
    float _padding;
} draw;

layout (std140, binding = 1) uniform GpuMaterialData {
    vec4 color_factor;
    float metal_factor;
    float rough_factor;
    float occlusion_strength;
    vec2 _padding;
} material;

layout(set = 0, binding = 2) uniform sampler2D color_map;
layout(set = 0, binding = 3) uniform sampler2D normal_map;
layout(set = 0, binding = 4) uniform sampler2D metal_rough_map;
layout(set = 0, binding = 5) uniform sampler2D occlusion_map;  

layout (triangles) in;
layout (line_strip, max_vertices = 6) out;
layout (location = 0) in vec3 in_pos[];
layout (location = 1) in vec4 in_normal[];

layout (location = 0) out vec4 out_color;

void main(void)
{	
	float normalLength = 0.06;
	for(int i=0; i<gl_in.length(); i++)
	{
		vec3 pos = gl_in[i].gl_Position.xyz;
		vec3 normal = in_normal[i].xyz;

		out_color = vec4(0.0, 0.0, 0.0, 1.0);// vec4(abs(normal), 1.);
        // out_color = vec4(0.0, 0.0, 0.0, 1.0);
		vec4 p1 = vec4(in_normal[i].xyz, 1.0);
		vec4 p2 = vec4(draw.normal * p1);
		vec4 p3 = abs(vec4(p2.xyz, 1.0));
		// out_color = p3;

		gl_Position = draw.projection * draw.view * (draw.model * vec4(pos, 1.0));
		EmitVertex();
        out_color = vec4(1.0, 1.0, 1.0, 1.0);
		gl_Position = draw.projection * draw.view * (draw.model * vec4(pos + normal * normalLength, 1.0));
		EmitVertex();

		EndPrimitive();
	}
}
