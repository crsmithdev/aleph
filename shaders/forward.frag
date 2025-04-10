#version 450

#extension GL_EXT_debug_printf : enable
#extension GL_GOOGLE_include_directive : require
#extension GL_EXT_buffer_reference : require
#pragma shader_stage(fragment)

// #include "./include/draw.glsl"
// #include "./include/scene.glsl"
// #include "./include/material.glsl"
#include "./include/util.glsl"

precision highp float;
precision highp int;
precision highp usampler2D;

layout (location = 0) in vec3 inPos;
layout (location = 1) in vec3 inNormal;
layout (location = 2) in vec2 inUv;
layout (location = 3) in vec4 inColor;
layout (location = 4) in vec3 inTangent;
layout (location = 5) in vec3 inBitangent;
layout (location = 6) in vec3 inNormalGen;
layout (location = 7) in mat3 inTbn;

layout(set = 0, binding = 2) uniform sampler2D colorMap;
layout(set = 0, binding = 3) uniform sampler2D normalMap;
layout(set = 0, binding = 4) uniform sampler2D metalRoughMap;
layout(set = 0, binding = 5) uniform sampler2D aoMap;


struct Light {
    vec3 position;
    vec3 color;
    float intensity;
};

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
// layout(location = 0) in vec3 inWorldPos;
// layout(location = 1) in vec3 inNormal;
// layout(location = 2) in vec3 inTangent;
// layout(location = 3) in vec2 inUv;
// layout(location = 4) in vec3 inColor;
// layout(location = 5) in vec3 inBitangent;
// layout(location = 6) in vec3 inNormalGen;

// layout(binding = 2) uniform sampler2D colorMap;
// layout(binding = 3) uniform sampler2D normalMap;
// layout(binding = 4) uniform sampler2D metalRoughMap;
// layout(binding = 5) uniform sampler2D aoMap;

layout(location = 0) out vec4 outColor;

const vec3 DIELECTRIC_FRESNEL = vec3(0.04, 0.04, 0.04); // nearly black
const vec3 METALLIC_DIFFUSE_CONTRIBUTION = vec3(0.0); // none

struct Material {
    vec3 normal;
    vec3 toEye;
    vec3 baseColor;
    float roughFactor;
    float roughness;
    float metalFactor;
    float metallic;
    float ao;
    float aoStrength;
};

vec3 lambertDiffuse(Material material) {
    return material.baseColor;//  vec3(1.0, 1.0, 1.0);
}


/**
 * Fresnel (F): Schlick's version
 *
 * If cosTheta 0 means 90dgr, so return big value, if is 1 means 0dgr return
 * just F0. Function modeled to have shape of most common fresnel
 * reflectance function shape.
 *
 * @param float cosTheta - cos(viewDirection V, halfway vector H),
 * @param vec3 F0 - surface reflectance at 0dgr. vec3 somewhat models wavelengths
 */
vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    vec3 r = F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
    // if (debugThrottleFrag()) {
    //     debugPrintfEXT("fresnelSchlick:  %v3f, cosTheta: %f, F0: %v3f, pow(1.0 - cosTheta, 5.0): %f", r, cosTheta, F0,  pow(1.0 - cosTheta, 5.0));
    // }
    return r;
}

/**
 * Normal distribution function (D): GGX
 *
 * Just standard implementation ('Real Shading in Unreal Engine 4' equation 2)
 *
 * @param vec3 N - normalized normal
 * @param vec3 H - halfway vector
 * @param float roughness [0,1]
 */
float distributionGGX(vec3 N, vec3 H, float roughness) {
    float a      = roughness*roughness;
    float a2     = a*a;
    float NdotH  = dotMax0(N, H);
    float NdotH2 = NdotH*NdotH;

    float num   = a2;
    float denom = NdotH2 * (a2 - 1.0) + 1.0;
    denom = PI * denom * denom;

    return num / denom;
}

/**
 * Self-shadowing Smith helper function.
 *
 * @see 'Real Shading in Unreal Engine 4' equation 4 line 1,2
 *
 * @param vec3 NdotV dot prod. between normal and vector to camera/light source
 * @param float roughness material property
 */
float geometrySchlickGGX(float NdotV, float roughness) {
    float r = (roughness + 1.0);
    float k = (r*r) / 8.0;

    float num   = NdotV;
    float denom = NdotV * (1.0 - k) + k;

    return num / denom;
}

/**
 * Self-shadowing (G): GGX
 *
 * Just standard implementation ('Real Shading in Unreal Engine 4' equation 4 line 3). We do calculate self-shadowing in directions light-point and point-camera, then mul.
 *
 * @param vec3 N normal at current frag
 * @param vec3 V frag -> point
 * @param vec3 L frag -> light
 * @param float roughness material property
 *
 */
float geometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
    float NdotV = dotMax0(N, V);
    float NdotL = dotMax0(N, L);
    float ggx2  = geometrySchlickGGX(NdotV, roughness);
    float ggx1  = geometrySchlickGGX(NdotL, roughness);
    float r = ggx1 * ggx2;
    // if (debugThrottleFrag()) {
    //     debugPrintfEXT("geometrySmith: %f, NdotV: %f, NdotL: %f, ggx2: %f, ggx1: %f, N: %v3f, V: %v3f, L: %v3f, roughness: %f", r, NdotV, NdotL, ggx2, ggx1, N, V, L, roughness);
    // }
    return r;
}

vec3 cookTorrance (Material material, vec3 V, vec3 L, out vec3 F) {
    vec3 H = normalize(V + L); // halfway vector
    vec3 N = inNormal; // normal at fragment

    // F - Fresnel
    vec3 F0 = mix(DIELECTRIC_FRESNEL, material.baseColor, material.metallic);
    F = fresnelSchlick(dotMax0(H, V), F0);
    // G - microfacet self-shadowing
    float G = geometrySmith(N, V, L, material.roughness);
    // D - Normals distribution
    float NDF = distributionGGX(N, H, material.roughness);

    // Cook-Torrance BRDF using NDF,G,F
    vec3 numerator = NDF * G * F;
    float denominator = 4.0 * dotMax0(N, V) * dotMax0(N, L);
    vec3 r = numerator / max(denominator, 0.001); // avoid div by 0

    return r;
}

vec3 pbr_mixDiffuseAndSpecular (const Material material, vec3 diffuse, vec3 specular, vec3 F) {
    vec3 kS = F;
    // kD for metalics is ~0 (means they have pure black diffuse color, but take color of specular)
    vec3 kD = mix(vec3(1.0) - kS, METALLIC_DIFFUSE_CONTRIBUTION, material.metallic);
    vec3 r =  kD * diffuse + specular;
    return r;
}

float attenuate(float distance, float radius, float intensity) {
    return 1.0 / (1.0 + distance * distance * (1.0 / radius)) * intensity;
}


vec3 pbr (Material material, Light light) {
    vec3 N = normalize(inNormal); // normal at fragment
    vec3 V = normalize(draw.camera_pos - inPos); // viewDir
    vec3 L = light.position - inPos; // wi in integral
    float distance = length(L);
    float attenuation = attenuate(distance, 20.0, light.intensity); // hardcoded for this demo
    L = normalize(L);

    // diffuse
    vec3 lambert = lambertDiffuse(material);

    // specular
    vec3 F;
    vec3 specular = cookTorrance(material, V, L, F);

    // final light calc.
    float NdotL = dotMax0(N, L);
    vec3 brdfFinal = pbr_mixDiffuseAndSpecular(material, lambert, specular, F);
    vec3 radiance = light.color * attenuation * light.intensity; // incoming color from light
    vec3 r =  brdfFinal * radiance * NdotL;
 
    return r;
}

Material createMaterial() {
    Material m;
    m.normal = texture(normalMap, inUv).rgb * 2.0 - 1.0;
    m.normal = normalize(inTbn * m.normal);
    m.toEye = normalize(draw.camera_pos.xyz - inPos);
    // m.baseColor = pow(texture(colorMap, inUv).xyz, vec3(2.2));
    m.baseColor = texture(colorMap, inUv).xyz, vec3(2.2);
    m.metallic = texture(metalRoughMap, inUv).b;
    m.roughness = texture(metalRoughMap, inUv).g;
    m.metalFactor = material.metal_factor;
    m.roughFactor = material.rough_factor;
    m.ao = texture(aoMap, inUv).r;
    m.aoStrength = material.occlusion_strength;

  return m;
}
vec3 doShading(Material material, Light lights[1]) {
    vec3 radianceSum = vec3(0.0);

    for (uint i = 0u; i < 1u; i++) {
        Light light = lights[i];

        vec3 contrib = pbr(material, light);

        /* // OR instead of PBR:
        vec3 L = normalize(light.position - material.positionWS); // wi in integral
        float NdotL = dotMax0(material.normal, L);
        vec3 radiance = light.color * light.intensity; // incoming color from light
        vec3 contrib = material.albedo * radiance * NdotL;
        */

        radianceSum += contrib;
        // if (debugThrottleFrag()) {
            // debugPrintfEXT("light %i contrib: %v3f -> sum: %v3f", i, contrib, radianceSum);
        // }
    }

vec3 ambient = vec3(0.03) * material.baseColor * material.ao;

    // if (debugThrottleFrag()) {
        // debugPrintfEXT("ambient: %v3f, radianceSum: %v3f", ambient, radianceSum);
    // }

    if (debugThrottleFrag()) {
         debugPrintfEXT("draw.model[0]: %v4f", draw.model[0]);
    }

    // not PBR, but we need this to highlight some details like collarbones etc.
    // float aoRadianceFactor = getCustom_AO(material.ao, u_aoStrength, u_aoExp);
    // radianceSum *= aoRadianceFactor;

    // vec4 contribSSS = calculateSSSForwardScattering(material);
    // vec3 sssForwardScattering = contribSSS.rgb * radianceSum * u_sssStrength;

    // float shadow = max(material.shadow, material.hairShadow);
    // float shadowContrib = clamp(shadow, 0.0, u_maxShadowContribution);
    // radianceSum = radianceSum * (1.0 - shadowContrib);
    return ambient + radianceSum; // + sssForwardScattering;

}

Light unpackLight(vec3 pos, vec4 color) {
    Light light;
    light.color = color.rgb;
    light.intensity = color.a;
    light.position = pos;

    return light;
}
// void main() {
 

//     Light[1] lights;
//     lights[0].position = vec3(0.0, -3.0, 3.0);
//     lights[0].color = vec3(1.0, 1.0, 1.0);
//     lights[0].intensity = 1.0;      

//     Material material = createMaterial();
//     vec3 color = doShading(material, lights);

//     // vec4 colorDebug = debugModeOverride(material, color);
//     // color = mix(color, colorDebug.rgb, colorDebug.a);
//     outColor = vec4(color, 1.0);
//     // outColor2 = uvec4(packNormal(material.normal), 255);

//     // vec3 toCaster = normalize(u_directionalShadowCasterPosition.xyz - v_Position);
//     // vec4 positionShadowSpace = u_directionalShadowMatrix_MVP * vec4(v_Position, 1);
//     // float shadowSim = shadowTestSimple(positionShadowSpace, material.normal, toCaster);
//     // color = mix(
//     // material.albedo,
//     // vec3(shadowSim),
//     // 0.3
//     // );  
// }

float distribution_ggx(vec3 normal, vec3 half_dir, float roughness)
{
    float a         = roughness * roughness;
    float a_2       = a * a;
    float n_dot_h   = max(dot(normal, half_dir), 0.0);
    float n_dot_h_2 = n_dot_h * n_dot_h;
	
    float nom    = a_2;
    float denom  = (n_dot_h_2 * (a_2 - 1.0) + 1.0);
    denom        = PI * denom * denom;
	
    return nom / denom;
}

float geometry_schlick_ggx(float n_dot_v, float roughness)
{
    float r = (roughness + 1.0);
    float k = (r * r) / 8.0;

    float nom   = n_dot_v;
    float denom = n_dot_v * (1.0 - k) + k;
	
    return nom / denom;
}
  
float geometry_smith(vec3 normal, vec3 view_dir, vec3 light_dir, float roughness)
{
    float n_dot_v = max(dot(normal, view_dir), 0.0);
    float n_dot_l = max(dot(normal, light_dir), 0.0);
    float ggx1 = geometry_schlick_ggx(n_dot_v, roughness);
    float ggx2 = geometry_schlick_ggx(n_dot_l, roughness);
	
    return ggx1 * ggx2;
}

vec3 fresnel_schlick(float cos_theta, vec3 fresnel_0)
{
    return fresnel_0 + (1.0 - fresnel_0) * pow(1.0 - cos_theta, 5.0);
}

vec3 fresnel_schlick_roughness(float cos_theta, vec3 fresnel_0, float roughness)
{
    return fresnel_0 + ( max(vec3(1.0 - roughness), fresnel_0) - fresnel_0 ) * pow(1.0 - cos_theta, 5.0);
}

void main() {
        Light[1] lights;
    lights[0].position = vec3(0.0, -3.0, 3.0);
    lights[0].color = vec3(1.0, 1.0, 1.0);
    lights[0].intensity = 1.0;      

    Material m = createMaterial(); 
    vec3 view_dir = normalize(draw.camera_pos - inPos);
    vec3 fresnel_0 = mix(vec3(0.04), m.baseColor, m.metallic); // F0 = 0.04 for dielectrics, F0 = baseColor for metals

    vec3 reflect_dir = reflect(-view_dir, inNormal);   

    // Over all lights:
    vec3 L_0 = vec3(0.0);

    for (int i = 0; i < 1; ++i)
    {
        Light light = lights[i];
        // Calculate light properties.
        vec3 light_colour = light.color * 20.0;

        vec3 light_dir = normalize(light.position - inPos);
        vec3 half_dir = normalize(view_dir + light_dir);

        float light_distance = length(light.position - inPos);
        float light_attenuation = 1.0 / (light_distance * light_distance);
        vec3 light_radiance = light_colour * light_attenuation;

        // Calculate Cook-Torrance specular BRDF: DFG / 4(ωo⋅n)(ωi⋅n)
        vec3 F = fresnel_schlick( max( dot(half_dir, view_dir), 0.0 ), fresnel_0 );
        float D = distribution_ggx(inNormal, half_dir, m.roughness);
        float G = geometry_smith(inNormal, view_dir, light_dir, m.roughness);

        float denom = 4.0 * max(dot(inNormal, view_dir), 0.0) * max(dot(inNormal, light_dir), 0.0) + 0.001;

        vec3 specular = (D * F * G) / denom;

        // Calculate ratio of reflected-refracted light.
        vec3 kS = F;
        vec3 kD = vec3(1.0) - kS;

        kD *= 1.0 - m.metallic;	

        // Calculate output radiance.
        float n_dot_l = max(dot(inNormal, light_dir), 0.0);

        L_0 += (kD * m.baseColor / PI + specular) * light_radiance * n_dot_l;
    }
    
    vec3 ambient = vec3(0.03) * m.baseColor * m.ao; // ambient occlusion
    vec3 color = ambient + L_0;

    // Gamma correct.
    // color = color / (color + vec3(1.0));
    // color = pow(color, vec3(1.0 / 2.2));

    outColor = vec4(color, 1.0); 

}