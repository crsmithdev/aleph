// #version 450

// #extension GL_GOOGLE_include_directive : require
// #extension GL_EXT_debug_printf : enable
// #include "./util.glsl"
// #include "./forward.glsl"

// layout (location = 0) in vec4 in_color;
// layout (location = 1) in vec3 in_normal;
// layout (location = 2) in vec4 in_tangent;
// layout (location = 3) in vec3 in_bitangent;
// layout (location = 4) in mat3 in_out_tbn;

// layout (location = 0) out vec4 out_color;

// void main(void)
// {
// 	out_color = vec4(in_color.rgb, 1.0);
// }
# version 450

layout(location = 0) in vec4 in_color;

layout(location = 0) out vec4 out_color;

void main()
{
    out_color = in_color;
}