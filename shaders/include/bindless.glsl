#define MAX_LIGHTS 4
#define MAX_MATERIALS 10

struct Light {
    vec3 position;
    vec4 color;
};

struct Material {
    vec4 color_factor;
    uint color_texture_index;
    uint normal_texture_index;
    float metal_factor;
    float rough_factor;
    uint metalrough_texture_index;
    float ao_strength;
    uint ao_texture_index;
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
    int debug_albedo;
    int debug_metallic;
    int debug_color;
    int debug_roughness;
    int debug_occlusion;
    int debug_tangents;
    int debug_bitangents;
    int debug_specular;
    int disable_normal_map;
    int force_defaults;
};

layout(std140, set = 0, binding = 0) uniform SceneData {
    mat4 view;
    mat4 projection;
    mat4 vp;
    vec3 cameraPos;
    int n_lights;
    Config config;
    Light lights[MAX_LIGHTS];
} u_scene;

layout(std140, set = 0, binding = 1) uniform ObjectData {
    Material materials[MAX_MATERIALS];
} u_object;

layout(set = 0, binding = 2) uniform sampler2D u_textures[];

layout(push_constant) uniform PushConstant {
    mat4 model;
    int material_index;
    int _padding0;
    int _padding1;
    int _padding2;
} p_constants;