layout (std140, binding = 2) uniform Material2 {
    vec4 color_factor;
    float metal_factor;
    float rough_factor;
    float ao_strength;
} u_material;

layout(set = 0, binding = 3) uniform sampler2D u_colorMap;
layout(set = 0, binding = 4) uniform sampler2D u_normalMap;
layout(set = 0, binding = 5) uniform sampler2D u_metalRoughMap;
layout(set = 0, binding = 6) uniform sampler2D u_aoMap;