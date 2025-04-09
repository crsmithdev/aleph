#define MAX_LIGHTS 16

struct Light {
    vec3 position;
    vec3 color;
    float intensity;
};

layout(binding = 0) uniform SceneBufferData {
    vec4 camera_pos;
    mat4 view;
    mat4 projection;
    mat4 vp;
    mat4 inverse_vp;
    mat4 normal;
    int numLights;
    vec4 lightAmbient;
    Light lights[MAX_LIGHTS];
} scene;