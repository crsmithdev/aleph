#version 450

#extension GL_EXT_debug_printf : enable
#extension GL_GOOGLE_include_directive : require
#extension GL_EXT_buffer_reference : require
#extension GL_EXT_nonuniform_qualifier : require
#pragma shader_stage(fragment)

precision highp float;
precision highp int;
precision highp usampler2D;

// #include "./include/scene.glsl"
// #include "./include/draw.glsl"
// #include "./include/material.glsl"
#include "./include/util.glsl"
#include "./include/bindless.glsl"

layout (location = 0) in vec3 inPos;
layout (location = 1) in vec3 inNormal;
layout (location = 2) in vec4 inTangent;
layout (location = 3) in vec2 inUv;
layout (location = 4) in vec4 inColor;
layout (location = 5) in mat3 inTbn;

layout (location = 0) out vec4 outColor;
// layout (set = 3, binding = 0) uniform sampler2D textures[];


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

vec3 calculateNormal()
{
    int normal_index = s_materials[p_constants.material_index].normal_texture_index;
    
    if (u_scene.config.disable_normal_map == 1) {
        return inNormal;
    }
    vec3 tangentNormal = texture(u_textures[normal_index], inUv).xyz * 2.0 - 1.0;
	// vec3 tangentNormal = texture(u_normalMap, inUv).xyz * 2.0 - 1.0;

	vec3 N = normalize(inNormal);
	vec3 T = normalize(inTangent.xyz);
	vec3 B = normalize(cross(N, T));
    mat3 TBN = mat3(T, B, N);

	return normalize(TBN * tangentNormal);
    // return normalize(TBN * inNormal);
}

void main() {
    vec2 uv = inUv;
    vec3 normal = calculateNormal();
    // vec3 normal = inNormal;
    vec3 bitangent = normalize(cross(normal, inTangent.xyz));

    int i = p_constants.material_index;
    int color_index = s_materials[i].color_texture_index;
    int normal_index = s_materials[i].normal_texture_index;
    int metalrough_index = s_materials[i].metalrough_texture_index;
    int ao_index = s_materials[i].ao_texture_index;

    // vec3 albedo = vec3(1.0);
    vec3 albedo = texture(u_textures[color_index], uv).xyz;
    // debugPrintfEXT("color_index: %v3f\n", albedoj);
    // if (u_scene.config.force_color == 1) {
    //     albedo = u_scene.config.force_color_factor.xyz;
    // }

    float metallic = 0.9;
    // float metallic = texture(u_textures[metalrough_index], uv).r;
    // float metallic = texture(u_textures[metalrough_index], uv).b * s_materials[i].metal_factor;
    // if (u_scene.config.force_metallic == 1) {
    //     metallic = u_scene.config.force_metallic_factor;
    // } 

    float roughness = 0.5;
    // if (u_scene.config.force_roughness == 1) {
    //     roughness = u_scene.config.force_roughness_factor;
    // }

    float ao = 1.0;
    // float ao = texture(u_textures[ao_index], uv).r * s_materials[i].ao_strength; 
    // if (u_scene.config.force_ao == 1) {
    //     ao = u_scene.config.force_ao_strength; 
    // }

    // if (u_scene.config.force_defaults == 1) {
    //     albedo = vec3(1.0, 1.0, 1.0);
    //     normal = vec3(0.5, 0.5, 1.0);
    //     metallic = 0.1;
    //     roughness = 0.5;
    //     ao = 1.0;
    // }

    vec3 view_dir = normalize(u_scene.cameraPos - inPos);
    vec3 fresnel_0 = mix(vec3(0.04), albedo, metallic);
    vec3 reflect_dir = reflect(-view_dir, inNormal);   

    vec3 L_0 = vec3(0.0);
    vec3 totalSpecular = vec3(0.0);

    for (int i = 0; i < u_scene.n_lights; ++i)
    {
        Light light = u_scene.lights[i];
        vec3 light_color = light.color.xyz * light.color.w;
        vec3 light_dir = normalize(light.position - inPos);
        vec3 half_dir = normalize(view_dir + light_dir);

        float light_distance = length(light.position - inPos);
        float light_attenuation = 1.0 / (light_distance * light_distance);
        vec3 light_radiance = light_color * light_attenuation;

        // Cook-Torrance specular BRDF
        vec3 F = fresnelSchlick( max( dot(half_dir, view_dir), 0.0 ), fresnel_0 );
        float D = distributionGGX(normal, half_dir, roughness);
        float G = geometrySmith(normal, view_dir, light_dir, roughness);

        float denom = 4.0 * max(dot(normal, view_dir), 0.0) * max(dot(inNormal, light_dir), 0.0) + 0.001;
        vec3 specular = (D * F * G) / denom;

        vec3 kS = F;
        vec3 kD = vec3(1.0) - kS;
        kD *= 1.0 - metallic;	

        float n_dot_l = max(dot(normal, light_dir), 0.0);

        totalSpecular += specular;
        L_0 += (kD * albedo / PI + specular) * light_radiance * n_dot_l;
    }
    
    vec3 ambient = vec3(0.03) * albedo * ao;
    vec3 color = ambient + L_0;

    if (u_scene.config.debug_normals == 1) {
        color = normal;
    }
    if (u_scene.config.debug_tangents == 1) {
        color = inTangent.xyz;
    }
    if (u_scene.config.debug_bitangents == 1) {
        color = bitangent;
    }
    if (u_scene.config.debug_specular == 1) {
        if (totalSpecular.r  <= 0.05 || totalSpecular.g <= 0.05 || totalSpecular.b <= 0.01) {
            color = vec3(1.0, 0.0, 0.0);
        } else if (totalSpecular.r  >= 0.30 || totalSpecular.g >= 0.30 || totalSpecular.b >= 0.30) {
            color = vec3(0.0, 1.0, 0.0);

        }
        // color = totalSpecular;
    }   

    outColor = vec4(color, 1.0); 
    
}