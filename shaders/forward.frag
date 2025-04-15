#version 450

#extension GL_EXT_debug_printf : enable
#extension GL_GOOGLE_include_directive : require
#extension GL_EXT_buffer_reference : require
#pragma shader_stage(fragment)

precision highp float;
precision highp int;
precision highp usampler2D;

#include "./include/scene.glsl"
#include "./include/draw.glsl"
#include "./include/material.glsl"

layout (location = 0) in vec3 inPos;
layout (location = 1) in vec3 inNormal;
layout (location = 2) in vec2 inUv;
layout (location = 3) in vec4 inColor;
layout (location = 4) in mat3 inTbn;

layout (location = 0) out vec4 outColor;

const float PI = 3.1415926535897932384626433832795;

float attenuate(float distance, float radius, float intensity) {
    return 1.0 / (1.0 + distance * distance * (1.0 / radius)) * intensity;
}

float distributionGGX(vec3 normal, vec3 half_dir, float roughness) {
    float a         = roughness * roughness;
    float a_2       = a * a;
    float n_dot_h   = max(dot(normal, half_dir), 0.0);
    float n_dot_h_2 = n_dot_h * n_dot_h;
	
    float nom    = a_2;
    float denom  = (n_dot_h_2 * (a_2 - 1.0) + 1.0);
    denom        = PI * denom * denom;
	
    return nom / denom;
}

float geometrySchlickGGX(float n_dot_v, float roughness) {
    float r = (roughness + 1.0);
    float k = (r * r) / 8.0;

    float nom   = n_dot_v;
    float denom = n_dot_v * (1.0 - k) + k;
	
    return nom / denom;
}
  
float geometrySmith(vec3 normal, vec3 view_dir, vec3 light_dir, float roughness) {
    float n_dot_v = max(dot(normal, view_dir), 0.0);
    float n_dot_l = max(dot(normal, light_dir), 0.0);
    float ggx1 = geometrySchlickGGX(n_dot_v, roughness);
    float ggx2 = geometrySchlickGGX(n_dot_l, roughness);
	
    return ggx1 * ggx2;
}

vec3 fresnelSchlick(float cos_theta, vec3 fresnel_0) {
    return fresnel_0 + (1.0 - fresnel_0) * pow(1.0 - cos_theta, 5.0);
}

void main() {
    vec3 normal = inTbn * texture(u_normalMap, inUv).rgb * 2.0 - 1.0;
    vec3 albedo = texture(u_colorMap, inUv).xyz;

    float metallic;
    if (u_scene.config.force_metallic > -0.01) {
        metallic = texture(u_metalRoughMap, inUv).b * u_material.metal_factor;
    } else {
        metallic = u_scene.config.force_metallic;
    }

    float roughness = texture(u_metalRoughMap, inUv).g * u_material.rough_factor;
    float ao = texture(u_aoMap, inUv).r * u_material.ao_strength;

    vec3 view_dir = normalize(u_scene.cameraPos - inPos);
    vec3 fresnel_0 = mix(vec3(0.04), albedo, metallic);
    vec3 reflect_dir = reflect(-view_dir, inNormal);   

    vec3 L_0 = vec3(0.0);

    for (int i = 0; i < u_scene.n_lights; ++i)
    {
        Light light = u_scene.lights[i];
        vec3 light_color = light.color.xyz * 20.0;//light.intensity;
        vec3 light_dir = normalize(light.position - inPos);
        vec3 half_dir = normalize(view_dir + light_dir);

        float light_distance = length(light.position - inPos);
        float light_attenuation = 1.0 / (light_distance * light_distance);
        vec3 light_radiance = light_color * light_attenuation;

        // Cook-Torrance specular BRDF
        vec3 F = fresnelSchlick( max( dot(half_dir, view_dir), 0.0 ), fresnel_0 );
        float D = distributionGGX(inNormal, half_dir, roughness);
        float G = geometrySmith(inNormal, view_dir, light_dir, roughness);

        float denom = 4.0 * max(dot(inNormal, view_dir), 0.0) * max(dot(inNormal, light_dir), 0.0) + 0.001;
        vec3 specular = (D * F * G) / denom;

        vec3 kS = F;
        vec3 kD = vec3(1.0) - kS;
        kD *= 1.0 - metallic;	

        float n_dot_l = max(dot(inNormal, light_dir), 0.0);

        L_0 += (kD * albedo / PI + specular) * light_radiance * n_dot_l;
    }
    
    vec3 ambient = vec3(0.03) * albedo * ao; // ambient occlusion
    vec3 color = ambient + L_0;

    outColor = vec4(color, 1.0); 
}