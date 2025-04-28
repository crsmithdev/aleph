#define MAX_LIGHTS 4

struct Light {
    vec3 position;
    vec4 color;
};

struct Config {
    int force_color;
    int force_metallic;
    int force_roughness;
    int force_ao;
    vec4 force_color_factor;
    float force_metallic_factor;
    float force_roughness_factor;
    float force_ao_strength;
    int debug_normals;
    int debug_tangents;
    int debug_bitangents;
    int debug_specular;
    int disable_normal_map;
    int force_defaults;
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