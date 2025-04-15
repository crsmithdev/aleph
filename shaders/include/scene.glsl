#define MAX_LIGHTS 4

struct Light {
    vec3 position;
    vec4 color;
};

struct Config {
    float force_metallic;
    float force_roughness;
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