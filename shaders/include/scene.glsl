#define MAX_LIGHTS 4

struct Light {
    vec3 position;
    vec4 color;
};

struct Config {
    vec4 force_color;
    vec2 force_metallic;
    vec2 force_roughness;
    vec2 force_ao;
    vec2 padding0;
};

layout(std140, binding = 0) uniform SceneBufferData {
    mat4 view;
    mat4 projection;
    mat4 vp;
    vec3 cameraPos;
    int n_lights;
    Config config;
    Light lights[MAX_LIGHTS];
} u_scene;