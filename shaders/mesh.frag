#version 450

#extension GL_EXT_debug_printf : enable
precision highp float;

layout (std140, binding = 0) uniform GpuSceneData {
	mat4 view;
    mat4 projection;
    mat4 view_projection;
    vec3 lights[4];
    vec3 camera_position;
    float _padding1;
} scene;

layout (std140, binding = 1) uniform GpuMaterialData {
    vec4 albedo;
    float _padding;
    float metallic;
    float roughness;
    float ao;
} material;

layout (std140, binding = 2) uniform GpuDrawData {
    mat4 model;
    mat4 model_view;
    mat4 model_view_projection;
    mat3 normal;
    vec3 position;
} draw;

layout(set = 0, binding = 3) uniform sampler2D albedoMap;
layout(set = 0, binding = 4) uniform sampler2D normalMap;
layout(set = 0, binding = 5) uniform sampler2D metallicMap;
layout(set = 0, binding = 6) uniform sampler2D roughnessMap;
layout(set = 0, binding = 7) uniform sampler2D aoMap;

layout (location = 0) in vec3 in_normal;
layout (location = 1) in vec3 in_color;
layout (location = 2) in vec2 in_tex_coords;
layout (location = 3) in vec3 in_world_position;

layout (location = 0) out vec4 frag_color;

const float PI = 3.14159265359;
// ----------------------------------------------------------------------------
float DistributionGGX(vec3 N, vec3 H, float roughness)
{
    float a = roughness*roughness;
    float a2 = a*a;
    float NdotH = max(dot(N, H), 0.0);
    float NdotH2 = NdotH*NdotH;

    float nom   = a2;
    float denom = (NdotH2 * (a2 - 1.0) + 1.0);
    denom = PI * denom * denom;

    return nom / denom;
}
// ----------------------------------------------------------------------------
float GeometrySchlickGGX(float NdotV, float roughness)
{
    float r = (roughness + 1.0);
    float k = (r*r) / 8.0;

    float nom   = NdotV;
    float denom = NdotV * (1.0 - k) + k;

    return nom / denom;
}
// ----------------------------------------------------------------------------
float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness)
{
    float NdotV = max(dot(N, V), 0.0);
    float NdotL = max(dot(N, L), 0.0);
    float ggx2 = GeometrySchlickGGX(NdotV, roughness);
    float ggx1 = GeometrySchlickGGX(NdotL, roughness);

    return ggx1 * ggx2;
}
// ----------------------------------------------------------------------------
vec3 fresnelSchlick(float cosTheta, vec3 F0)
{
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}                                                                               
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// Easy trick to get tangent-normals to world-space to keep PBR code simplified.
// Don't worry if you don't get what's going on; you generally want to do normal 
// mapping the usual way for performance anyways; I do plan make a note of this 
// technique somewhere later in the normal mapping tutorial.
vec3 getNormalFromMap()
{
    vec3 tangentNormal = texture(normalMap, in_tex_coords).xyz * 2.0 - 1.0;

    vec3 Q1  = dFdx(in_world_position);
    vec3 Q2  = dFdy(in_world_position);
    vec2 st1 = dFdx(in_tex_coords);
    vec2 st2 = dFdy(in_tex_coords);

    vec3 N   = normalize(in_normal);
    vec3 T  = normalize(Q1*st2.t - Q2*st1.t);
    vec3 B  = -normalize(cross(N, T));
    mat3 TBN = mat3(T, B, N);

    return normalize(TBN * tangentNormal);
}

void main()
{	


    vec3 lightPositions[4] = {
        {-10., 10., 0.},
        {10., 10., 0.},
        {10., -10., 0.},
        {-10., -10., 0.}
    }; 
    vec3 lightColors[4] = {
        {300., 300., 300.},
        {300., 300., 300.},
        {300., 300., 300.},
        {300., 300., 300.}
    }; 
    vec3 albedo     = pow(texture(albedoMap, in_tex_coords).rgb, vec3(2.2));
    float metallic  = texture(metallicMap, in_tex_coords).r;
    float roughness = texture(roughnessMap, in_tex_coords).r;
    float ao        = texture(aoMap, in_tex_coords).r;

    vec3 N = in_normal;//ememgetNormalFromMap();
    vec3 V = normalize(scene.camera_position - in_world_position);

    // calculate reflectance at normal incidence; if dia-electric (like plastic) use F0 
    // of 0.04 and if it's a metal, use the albedo color as F0 (metallic workflow)    
    vec3 F0 = vec3(0.04); 
    F0 = mix(F0, albedo, metallic);

    // reflectance equation
    vec3 Lo = vec3(0.0);
    for(int i = 0; i < 4; ++i)                                                                                  
    {
        // calculate per-light radiance
        vec3 L = normalize(lightPositions[i] - in_world_position);
        vec3 H = normalize(V + L);
        float distance = length(lightPositions[i] - in_world_position);
        float attenuation = 1.0 / (distance * distance);
        vec3 radiance = lightColors[i] * attenuation;

        // Cook-Torrance BRDF
        float NDF = DistributionGGX(N, H, roughness);   
        float G   = GeometrySmith(N, V, L, roughness);      
        vec3 F    = fresnelSchlick(max(dot(H, V), 0.0), F0);
           
        vec3 numerator    = NDF * G * F; 
        float denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001; // + 0.0001 to prevent divide by zero
        vec3 specular = numerator / denominator;
        
        // kS is equal to Fresnel
        vec3 kS = F;
        // for energy conservation, the diffuse and specular light can't
        // be above 1.0 (unless the surface emits light); to preserve this
        // relationship the diffuse component (kD) should equal 1.0 - kS.
        vec3 kD = vec3(1.0) - kS;
        // multiply kD by the inverse metalness such that only non-metals 
        // have diffuse lighting, or a linear blend if partly metal (pure metals
        // have no diffuse light).
        kD *= 1.0 - metallic;	  

        // scale light by NdotL
        float NdotL = max(dot(N, L), 0.0);        

        // add to outgoing radiance Lo
        Lo += (kD * albedo / PI + specular) * radiance * NdotL;  // note that we already multiplied the BRDF by the Fresnel (kS) so we won't multiply by kS again
    }    
    


    vec3 ambient = vec3(0.03) * albedo * ao;
    
    vec3 color = ambient + Lo;

    // HDR tonemapping
    color = color / (color + vec3(1.0));
    // gamma correct
    color = pow(color, vec3(1.0/2.2)); 

    frag_color = vec4(color, 1.0);

}