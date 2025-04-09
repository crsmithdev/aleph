#version 450

#extension GL_GOOGLE_include_directive : require
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

precision highp float;

layout(location = 0) in vec3 in_world_pos;
layout(location = 1) in vec3 in_normal;
layout(location = 2) in vec2 in_uv;
layout(location = 3) in vec4 in_color;
layout(location = 4) in vec3 in_tangent;
layout(location = 5) in vec3 in_bitangent;
layout(location = 6) in vec3 normal_derived;

layout(location = 0) out vec4 out_color;

const float PI = 3.14159265359;
const bool HDR_TONEMAP = false;
const bool GAMMA_CORRECT = false;
const float LIGHT_DISTANCE = 5.;
const float LIGHT_INTENSITY = 10;
const float LIGHT_RADIUS = 10.;
const int N_LIGHTS = 3;

const vec3 light_positions[N_LIGHTS] = {
    vec3(0., LIGHT_DISTANCE, 0.), 
    vec3(LIGHT_DISTANCE, 0., 0.), 
    vec3(0., 0., LIGHT_DISTANCE), 
};

const vec3 light_intensities[N_LIGHTS] = {
    vec3(LIGHT_INTENSITY, LIGHT_INTENSITY, LIGHT_INTENSITY), 
    vec3(LIGHT_INTENSITY, LIGHT_INTENSITY, LIGHT_INTENSITY), 
    vec3(LIGHT_INTENSITY, LIGHT_INTENSITY, LIGHT_INTENSITY), 
};

bool can_log() {
    vec4 v = gl_FragCoord;
    return v.x > 630.0 && v.x < 631.0 && v.y > 400.0 && v.y < 401.0;
}

float dotMax0 (vec3 n, vec3 toEye){
    return max(0.0, dot(n, toEye));
}


float distribution_ggx(vec3 N, vec3 H, float rough) {
    float a = rough * rough;
    float a2 = a * a;
    float NdotH = max(dot(N, H), 0.0);
    float NdotH2 = NdotH * NdotH;

    float nom = a2;
    float denom = (NdotH2 * (a2 - 1.0) + 1.0);
    denom = PI * denom * denom;

    return nom / denom;
}

float geometry_schlick_ggx(float NdotV, float rough) {
    float r = (rough + 1.0);
    float k = (r * r) / 8.0;

    float nom = NdotV;
    float denom = NdotV * (1.0 - k) + k;
    return nom / denom;
}

float geometry_smith(vec3 N, vec3 V, vec3 L, float rough) {
    float NdotV = max(dot(N, V), 0.0);
    float NdotL = max(dot(N, L), 0.0);
    float ggx2 = geometry_schlick_ggx(NdotV, rough);
    float ggx1 = geometry_schlick_ggx(NdotL, rough);
    return ggx1 * ggx2;
}

vec3 fresnel_schlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

float attenuate(float distance, float range) {
    if(range < 0.0) {
        return 1.0;
    }
    return max(min(1.0 - pow(distance / range, 4.0), 1.0), 0.0) / pow(distance, 2.0);
}

vec3 gamma_uncorrect(vec3 srgb) {
    return pow(srgb, vec3(2.2));
}

vec3 gamma_correct(vec3 linear) {
    return pow(linear, vec3(1.0/2.2));
}

vec3 hdr_tonemap(vec3 color) {
    return color / (color + vec3(1.0));
}

void main() {
    vec3 color_tx = texture(color_map, in_uv).rgb;
    vec3 normal_tx = texture(normal_map, in_uv).rgb;

    if (GAMMA_CORRECT) {
        color_tx = gamma_uncorrect(color_tx.rgb);
    }

    vec3 albedo = color_tx * material.color_factor.rgb * in_color.rgb;
    vec3 normal = texture(normal_map, in_uv).rgb * 2.0 - 1.0;
    float metal = clamp(texture(metal_rough_map, in_uv).g * material.metal_factor, 1e-4, 1.0);;
    float rough =  clamp(texture(metal_rough_map, in_uv).b * material.rough_factor, 1e-4, 1.0);
    float occlusion = 1.0 + material.occlusion_strength * (texture(occlusion_map, in_uv).r - 1.0);

    if (can_log()) {
        debugPrintfEXT("color_tx: %v3f, normal_tx: %v3f\n", color_tx, normal_tx);
        debugPrintfEXT("albedo: %v3f, normal: %v3f, metal: %f, rough: %f, occlusion: %f\n", albedo, normal, metal, rough, occlusion);
    }

    vec3 N = normalize(in_normal);
    vec3 V = normalize(draw.camera_pos - in_world_pos);
    vec3 F0 = vec3(0.04);
    F0 = mix(F0, albedo, metal);
    if (can_log()) {
        debugPrintfEXT("color_tx: %v3f, normal_tx: %v3f\n", color_tx, normal_tx);
        debugPrintfEXT("albedo: %v3f, normal: %v3f, metal: %f, rough: %f, occlusion: %f\n", albedo, normal, metal, rough, occlusion);
        debugPrintfEXT("N: %v3f, V: %v3f, F0: %v3f \n", N, V, F0);
    }

    vec3 Lo = vec3(0.0);
    for(int i = 0; i < N_LIGHTS;++ i) {
        vec3 L = normalize(light_positions[i] - in_world_pos);
        vec3 H = normalize(V + L);
        float distance = length(light_positions[i] - in_world_pos);
        float attenuation = attenuate(distance, LIGHT_RADIUS);
        vec3 radiance = light_intensities[i] * attenuation;

        float NDF = distribution_ggx(N, H, rough);
        float G = geometry_smith(N, V, L, rough);
        vec3 F = fresnel_schlick(max(dot(H, V), 0.0), F0);

        vec3 nominator = NDF * G * F;
        float denominator = 4 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0);
        vec3 specular = nominator / max(denominator, 0.001);

        vec3 kS = F;
        vec3 kD = vec3(1.0) - kS;
        kD *= 1.0 - metal;
        float NdotL = max(dot(N, L), 0.0);



        // debugFrag("specular: %v3f", specular);

        Lo += (kD * albedo / PI + specular) * radiance * NdotL;

        if (can_log()) {
            debugPrintfEXT("L: %v3f, H: %v3f, distance: %f, attenuation: %f\n", L, H, distance, attenuation);
            debugPrintfEXT("NDF: %f, G: %f, F: %v3f\n", NDF, G, F);
            debugPrintfEXT("nominator: %v3f, denominator: %f\n", nominator, denominator);
            debugPrintfEXT("specular: %v3f\n", specular);
            debugPrintfEXT("kS: %v3f, kD: %v3f, NdotL: %f\n", kS, kD, NdotL);
            debugPrintfEXT("Added: %v3f\n", (kD * albedo / PI + specular) * radiance * NdotL);
            debugPrintfEXT("Lo: %v3f\n", Lo);
        }
    }

    vec3 ambient = vec3(0.03) * albedo * occlusion;
    vec3 color = ambient + Lo;

    // #ifdef DEBUG_FRAG
    //     debugPrintfEXT("Lo: %v3f, ambient: %v3f, color: %v3f\n", Lo, ambient, color);
    // #endif

    if (GAMMA_CORRECT) {
        color = gamma_correct(color);
    }
    if (HDR_TONEMAP) {
        color = hdr_tonemap(color);
    }
    
    out_color = vec4(color, 1.0);
}