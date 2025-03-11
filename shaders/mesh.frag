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
layout (location = 1) in vec4 in_tangent;
layout (location = 2) in vec2 in_tex_coords;
layout (location = 3) in vec3 in_world_position;

layout (location = 0) out vec4 frag_color;

const float PI = 3.14159265359;
#define ALBEDO pow(texture(albedoMap, in_tex_coords).rgb, vec3(2.2))

float DistributionGGX(vec3 N, vec3 H, float roughness)
{
    float a      = roughness*roughness;
    float a2     = a*a;
    float NdotH  = max(dot(N, H), 0.0);
    float NdotH2 = NdotH*NdotH;
	
    float num   = a2;
    float denom = (NdotH2 * (a2 - 1.0) + 1.0);
    denom = PI * denom * denom;
	
    return num / denom;
}

float GeometrySchlickGGX(float NdotV, float roughness)
{
    float r = (roughness + 1.0);
    float k = (r*r) / 8.0;

    float num   = NdotV;
    float denom = NdotV * (1.0 - k) + k;
	
    return num / denom;
}
float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness)
{
    float NdotV = max(dot(N, V), 0.0);
    float NdotL = max(dot(N, L), 0.0);
    float ggx2  = GeometrySchlickGGX(NdotV, roughness);
    float ggx1  = GeometrySchlickGGX(NdotL, roughness);
	
    return ggx1 * ggx2;
}
vec3 fresnelSchlick(float cosTheta, vec3 F0)
{
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}  
vec3 calculateNormal()
{
	vec3 tangentNormal = texture(normalMap, in_tex_coords).xyz * 2.0 - 1.0;

	vec3 N = normalize(in_normal);
	vec3 T = normalize(in_tangent.xyz);
	vec3 B = normalize(cross(N, T));
	mat3 TBN = mat3(T, B, N);
	return normalize(TBN * tangentNormal);
}

// Normal Distribution function --------------------------------------
float D_GGX(float dotNH, float roughness)
{
	float alpha = roughness * roughness;
	float alpha2 = alpha * alpha;
	float denom = dotNH * dotNH * (alpha2 - 1.0) + 1.0;
	return (alpha2)/(PI * denom*denom); 
}

// Geometric Shadowing function --------------------------------------
float G_SchlicksmithGGX(float dotNL, float dotNV, float roughness)
{
	float r = (roughness + 1.0);
	float k = (r*r) / 8.0;
	float GL = dotNL / (dotNL * (1.0 - k) + k);
	float GV = dotNV / (dotNV * (1.0 - k) + k);
	return GL * GV;
}
vec3 F_Schlick(float cosTheta, vec3 F0)
{
	return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

vec3 SpecularContribution(vec3 L, vec3 V, vec3 N, vec3 F0, float metallic, float roughness)
{
	// Precalculate vectors and dot products	
	vec3 H = normalize (V + L);
	float dotNH = clamp(dot(N, H), 0.0, 1.0);
	float dotNV = clamp(dot(N, V), 0.0, 1.0);
	float dotNL = clamp(dot(N, L), 0.0, 1.0);

	// Light color fixed
	vec3 lightColor = vec3(1.0);

	vec3 color = vec3(0.0);

	if (dotNL > 0.0) {
		// D = Normal distribution (Distribution of the microfacets)
		float D = D_GGX(dotNH, roughness); 
		// G = Geometric shadowing term (Microfacets shadowing)
		float G = G_SchlicksmithGGX(dotNL, dotNV, roughness);
		// F = Fresnel factor (Reflectance depending on angle of incidence)
		vec3 F = F_Schlick(dotNV, F0);		
		vec3 spec = D * F * G / (4.0 * dotNL * dotNV + 0.001);		
		vec3 kD = (vec3(1.0) - F) * (1.0 - metallic);			
		color += (kD * ALBEDO / PI + spec) * dotNL;
	}

	return color;
}

vec3 test(vec3 lightPosition, vec3 lightColor, vec3 N, vec3 V, vec3 F0, float metallic, float roughness, vec3 albedo) {
    vec3 Lo = vec3(0.0);
     vec3 L = normalize(lightPosition - in_world_position);
    vec3 H = normalize(V + L);
    float distance    = length(lightPosition - in_world_position);
    float attenuation = 1.0 / (distance * distance);
    vec3 radiance     = lightColor * attenuation;        
    
    // cook-torrance brdf
    float NDF = DistributionGGX(N, H, roughness);        
    float G   = GeometrySmith(N, V, L, roughness);      
    vec3 F    = fresnelSchlick(max(dot(H, V), 0.0), F0);       
    
    vec3 kS = F;
    vec3 kD = vec3(1.0) - kS;
    kD *= 1.0 - metallic;	  
    
    vec3 numerator    = NDF * G * F;
    float denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001;
    vec3 specular     = numerator / denominator;  
        
    // add to outgoing radiance Lo
    float NdotL = max(dot(N, L), 0.0);                
    Lo += (kD * albedo / PI + specular) * radiance * NdotL; 

    return Lo;
}


vec3 BRDF(vec3 L, vec3 V, vec3 N, vec3 F0, float metallic, float roughness)
{
	// Precalculate vectors and dot products	
	vec3 H = normalize (V + L);
	float dotNV = clamp(dot(N, V), 0.0, 1.0);
	float dotNL = clamp(dot(N, L), 0.0, 1.0);
	float dotLH = clamp(dot(L, H), 0.0, 1.0);
	float dotNH = clamp(dot(N, H), 0.0, 1.0);

	// Light color fixed
	vec3 lightColor = vec3(1.0);

	vec3 color = vec3(0.0);

	if (dotNL > 0.0)
	{
		float rroughness = max(0.05, roughness);
		// D = Normal distribution (Distribution of the microfacets)
		float D = D_GGX(dotNH, roughness); 
		// G = Geometric shadowing term (Microfacets shadowing)
		float G = G_SchlicksmithGGX(dotNL, dotNV, rroughness);
		// F = Fresnel factor (Reflectance depending on angle of incidence)
		vec3 F = F_Schlick(dotNV, F0);

		vec3 spec = D * F * G / (4.0 * dotNL * dotNV);

		color += spec * dotNL * lightColor;
	}

	return color;
}
void main()
{		  
        vec3 lightPositions[4] = {
        {-5., 5., 0.},
        {5., 5., 0.},
        {5., -5., 0.},
        {-5., -5., 0.}
    }; 
    vec3 lightColors[4] = {
        vec3(300.0, 300.0, 300.0),
        vec3(300.0, 300.0, 300.0),
        vec3(300.0, 300.0, 300.0),
        vec3(300.0, 300.0, 300.0),
    };
        float metallic  = texture(metallicMap, in_tex_coords).b;
    float roughness = texture(roughnessMap, in_tex_coords).g;
    vec3 albedo = texture(albedoMap, in_tex_coords).rgb;
	vec3 N = normalize(in_normal);
	vec3 V = normalize(scene.camera_position - in_world_position);
    vec3 F0 = mix(vec3(0.04), ALBEDO, metallic);

    // vec3 albedo     = pow(texture(albedoMap, in_tex_coords).rgb, vec3(2.2));

    // float ao        = texture(aoMap, in_tex_coords).rrr;

    // metallic = 0.5;
    // roughness = 0.5;

	// Specular contribution
	vec3 Lo = vec3(0.0);
    vec3 brdf = vec3(0.0);
    for(int i = 0; i < 4; ++i)                                                                                  
    {
        Lo += test(lightPositions[i], lightColors[i], N, V, F0, metallic, roughness, albedo);
        // vec3 L = normalize(lightPositions[i] - in_world_position);
        // Lo += SpecularContribution(L, V, N, F0, metallic, roughness);
        // brdf += BRDF(L, V, N, F0, metallic, roughness);
	};

    vec3 diffuse = ALBEDO;
    vec3 F = F0;
    
    brdf = vec3(0.0, 0.0, 0.0);
    vec3 reflection = vec3(1.0, 1.0, 1.0);
    vec3 specular = (F * Lo.x + Lo.y);
    vec3 kD = 1.0 - F;
	kD *= 1.0 - metallic;	  

    kD = ALBEDO;
    vec3 ambient = (kD * diffuse + specular) * texture(aoMap, in_tex_coords).rrr;;
	// Combine with ambient
	vec3 color = Lo + ambient;

	// Gamma correct
	color = pow(color, vec3(0.4545));

	frag_color = vec4(color, 1.0);
}
