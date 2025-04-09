#version 450

// #extension GL_GOOGLE_include_directive : require
// #extension GL_EXT_buffer_reference : require
// #pragma shader_stage(fragment)

// #include "./include/draw.glsl"
// #include "./include/scene.glsl"
// #include "./include/material.glsl"
// #include "./include/util.glsl"

precision highp float;
precision highp int;
precision highp usampler2D;

layout (location = 0) in vec4 inPos;
layout (location = 1) in vec3 inNormal;
layout (location = 2) in vec2 inUv;
layout (location = 3) in vec4 inColor;
layout (location = 4) in vec3 inTangent;
layout (location = 5) in vec3 inBitangent;
layout (location = 6) in vec3 inNormalGen;
layout (location = 7) in vec3 inWorldPos;

layout(set = 0, binding = 2) uniform sampler2D colorMap;
layout(set = 0, binding = 3) uniform sampler2D normalMap;
layout(set = 0, binding = 4) uniform sampler2D metalRoughMap;
layout(set = 0, binding = 5) uniform sampler2D aoMap;


struct Light {
    vec3 position;
    vec3 color;
    float intensity;
};

layout (binding = 1) uniform Material2 {
    vec4 color_factor;
    float metal_factor;
    float rough_factor;
    float occlusion_strength;
} material2;


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
vec2 fixOpenGLTextureCoords_AxisY(vec2 uv) {
  return vec2(uv.x, 1.0 - uv.y);
}



float dotMax0 (vec3 n, vec3 toEye){
  return max(0.0, dot(n, toEye));
}

vec3 readModelTexture_srgb(sampler2D tex, vec2 coords) {
  coords = fixOpenGLTextureCoords_AxisY(coords);
  return texture(tex, coords).rgb; // as uint [0-255]
}

vec3 readModelTexture_uint(usampler2D tex, vec2 coords) {
  coords = fixOpenGLTextureCoords_AxisY(coords);
  uvec3 value = texture(tex, coords).rgb;
  return vec3(value) / 255.0;
}

const float PI = 3.1415926535897932384626433832795;
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
    return vec3(1.0, 1.0, 1.0);
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
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
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

    return ggx1 * ggx2;
}

vec3 cookTorrance (Material material, vec3 V, vec3 L, out vec3 F) {
    vec3 H = normalize(V + L); // halfway vector
    vec3 N = material.normal; // normal at fragment

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
    return numerator / max(denominator, 0.001); // avoid div by 0
}

vec3 pbr_mixDiffuseAndSpecular (const Material material, vec3 diffuse, vec3 specular, vec3 F) {
    vec3 kS = F;
    // kD for metalics is ~0 (means they have pure black diffuse color, but take color of specular)
    vec3 kD = mix(vec3(1.0) - kS, METALLIC_DIFFUSE_CONTRIBUTION, material.metallic);
    return kD * diffuse + specular;
}

float attenuate(float distance, float radius) {
    float nominator = pow(clamp(1. - pow(distance / radius, 4.), 0., 1.), 2.);
    float denominator = distance * distance + 1.;

    return nominator / denominator;
}


vec3 pbr (Material material, Light light) {
    vec3 N = material.normal; // normal at fragment
    vec3 V = normalize(draw.camera_pos - inWorldPos); // viewDir
    vec3 L = light.position - inWorldPos; // wi in integral
    // float attenuation = lightAttenuation(length(L), light.radius);
    float attenuation = 1.0; // hardcoded for this demo
    L = normalize(L);

    // diffuse
    vec3 lambert = lambertDiffuse(material);

    // specular
    vec3 F;
    vec3 specular = cookTorrance(material, V, L, F);
    specular = specular;//* material.specularMul; // not PBR, but simplifies material setup

    // final light calc.
    float NdotL = dotMax0(N, L);
    vec3 brdfFinal = pbr_mixDiffuseAndSpecular(material, lambert, specular, F);
    vec3 radiance = light.color * attenuation * light.intensity; // incoming color from light
    return brdfFinal * radiance * NdotL;
}

// void main() {
//     outColor = vec4(inColor, 1.0);
// }

Material createMaterial() {
    Material material;
    material.normal = normalize(inNormal); // normalize here as it was interpolated between 3 vertices and is no longer normalized
    material.toEye = normalize(draw.camera_pos.xyz - inWorldPos);
    material.baseColor = readModelTexture_srgb(colorMap, inUv);
    material.metallic = texture(metalRoughMap, inUv).g;
    material.roughness = texture(metalRoughMap, inUv).b;
    material.ao = texture(aoMap, inUv).r;
    material.aoStrength = 1.0;

    // convert specular/smoothness -> roughness
    // material.roughness = 1.0 - readSpecular();

    // vec3 toCaster = normalize(u_directionalShadowCasterPosition.xyz - v_Position);
    // material.shadow = 1.0 - calculateDirectionalShadow(
    //     u_directionalShadowDepthTex,
    //     v_PositionLightShadowSpace, material.normal, toCaster,
    //     u_shadowBiasForwardShading,
    //     u_shadowRadiusForwardShading
    // );
    // material.hairShadow = readHairShadow();

  return material;
}
vec3 doShading(Material material, Light lights[1]) {
    // vec3 ambient = scene.lightAmbient.rgb * scene.lightAmbient.a * material.ao;
    vec3 ambient = vec3(0.5, 0.5, 0.5) * material.ao;
    vec3 radianceSum = vec3(0.0);

    for (uint i = 0u; i < 3u; i++) {
        Light light = lights[i];

        vec3 contrib = pbr(material, light);

        /* // OR instead of PBR:
        vec3 L = normalize(light.position - material.positionWS); // wi in integral
        float NdotL = dotMax0(material.normal, L);
        vec3 radiance = light.color * light.intensity; // incoming color from light
        vec3 contrib = material.albedo * radiance * NdotL;
        */

        radianceSum += contrib;
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
void main() {
 

    Light[1] lights;
    lights[0].position = vec3(0.0, -5.0, 0.0);
    lights[0].color = vec3(1.0, 1.0, 1.0);
    lights[0].intensity = 1.0;      

    Material material = createMaterial();
    vec3 color = doShading(material, lights);

    // vec4 colorDebug = debugModeOverride(material, color);
    // color = mix(color, colorDebug.rgb, colorDebug.a);
    outColor = vec4(color, 1.0);
    // outColor2 = uvec4(packNormal(material.normal), 255);

    // vec3 toCaster = normalize(u_directionalShadowCasterPosition.xyz - v_Position);
    // vec4 positionShadowSpace = u_directionalShadowMatrix_MVP * vec4(v_Position, 1);
    // float shadowSim = shadowTestSimple(positionShadowSpace, material.normal, toCaster);
    // color = mix(
    // material.albedo,
    // vec3(shadowSim),
    // 0.3
    // );  
}