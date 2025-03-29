#version 450

#extension GL_GOOGLE_include_directive : require
#extension GL_EXT_debug_printf : enable
#include "./util.glsl"
#include "./forward.glsl"

layout (location = 0) in vec3 in_pos[];
layout (location = 1) in vec4 in_normal[];

layout (location = 0) out vec4 out_color;

// void main(void)
// {	
// 	float normalLength = 0.3;
// 	for(int i=0; i<gl_in.length(); i++)
// 	{
// 		vec3 pos = gl_in[i].gl_Position.xyz;
// 		vec3 normal = in_normal[i].xyz;

// 		out_color = vec3(0.0, 1.0, 0.0);

// 		gl_Position = draw.projection * draw.view * (draw.model * vec4(pos, 1.0));
// 		EmitVertex();
// 		gl_Position = draw.projection * draw.view * (draw.model * vec4(pos + normal * normalLength, 1.0));
// 		EmitVertex();

// 		// out_color = vec3(1.0, 0.0, 0.0);
// 		// gl_Position = draw.projection * (draw.model * vec4(pos, 1.0));
// 		// EmitVertex();
// 		// gl_Position = draw.projection * (draw.model * vec4(pos + in_tangent[i].xyz * tangentLength, 1.0));
// 		// EmitVertex();

// 		EndPrimitive();
// 	}
// }

layout (triangles) in;
layout (line_strip, max_vertices = 6) out;

void main(void)
{	
	float normalLength = 0.1;
	for(int i=0; i<gl_in.length(); i++)
	{
		const vec4 p0 = draw.model_view_projection * gl_in[i].gl_Position;
		gl_Position = p0;
		out_color = vec4(1.0, 0.0, 0.0, 1.0);
		EmitVertex();

		// const vec4 p1 = draw.model_view_projection * vec4(in_pos[i], 1.0);

		const vec4 p1 = draw.model_view_projection
		 * vec4(gl_in[i].gl_Position.xyz + in_normal[i].xyz, 1.0);
		out_color = vec4(1.0, 0.0, 0.0, 1.0);
		EmitVertex();

		EndPrimitive();
	}
}