static const float PI = 3.1415926535897932384626433832795;

#define DEBUG_COLOR ((config.flags & (1 << 0)) != 0)
#define DEBUG_NORMALS ((config.flags & (1 << 1)) != 0)
#define DEBUG_TANGENTS ((config.flags & (1 << 2)) != 0)
#define DEBUG_METALLIC ((config.flags & (1 << 3)) != 0)
#define DEBUG_ROUGHNESS ((config.flags & (1 << 4)) != 0)
#define DEBUG_OCCLUSION ((config.flags & (1 << 5)) != 0)
#define DEBUG_TEXCOORDS0 ((config.flags & (1 << 6)) != 0)

#define DISABLE_COLOR_MAP ((config.flags & (1 << 8)) != 0)
#define DISABLE_NORMAL_MAP ((config.flags & (1 << 9)) != 0)
#define DISABLE_METAL_ROUGH_MAP ((config.flags & (1 << 10)) != 0)
#define DISABLE_OCCLUSION_MAP ((config.flags & (1 << 11)) != 0)
#define DISABLE_TANGENTS ((config.flags & (1 << 12)) != 0)

#define OVERRIDE_COLOR ((config.flags & (1 << 16)) != 0)
#define OVERRIDE_METALLIC ((config.flags & (1 << 17)) != 0)
#define OVERRIDE_ROUGHNESS ((config.flags & (1 << 18)) != 0)
#define OVERRIDE_OCCLUSION ((config.flags & (1 << 19)) != 0)
#define OVERRIDE_LIGHTS ((config.flags & (1 << 20)) != 0)

#define DEBUG_ANY ((config.flags & 0x0000000000000000FFFFFFFF) != 0)
#define DISABLE_ANY ((config.flags & 0x00000000FFFFFFFF00000000) == 0)
#define OVERRIDE_ANY ((config.flags & 0xFFFFFFFF0000000000000000) != 0)

[[vk::binding(0, 0)]]
ConstantBuffer<CpuConfig> config;
[[vk::binding(1, 0)]]
ConstantBuffer<Scene> scene;
[[vk::binding(2, 0)]]
ConstantBuffer<ObjectData> materials;
[[vk::binding(3, 0)]]
Sampler2D textures[]; // Combined image samplers array

[shader("vertex")]
FsInput vertexMain(VsInput input, uniform PushConstants object)
{
    FsInput output;
    float4 position = mul(float4(input.position, 1.0), object.model);
    float3x3 model = (float3x3)object.model;

    output.position = mul(scene.projection, mul(scene.view, position));
    output.wPosition = position.xyz;
    // Use inverse transpose for proper normal transformation
    // output.normal = normalize(mul(input.normal, (float3x3)object.model));
    output.normal = input.normal;
    output.tangent = input.tangent;//float4(mul(input.tangent.xyz, (float3x3)object.model), 1.0);
    output.texCoords0 = float2(input.uvx, input.uvy);
    output.color = input.color;
    
    return output;
}

[shader("fragment")]
float4 fragmentMain(FsInput input, uniform PushConstants object) : SV_Target
{
    Material material = unpackMaterial(object.materialIndex, input);

    float3 viewDir = normalize(scene.cameraPos - input.wPosition);
    float3 color = float3(0.0);

    for (uint i = 0; i < scene.n_lights && i < 1; ++i) {
        Light light;
        light.color = scene.lights[i].color;
        // light.intensity = scene.lights[i].intensity;
        light.position = scene.lights[i].position;
        if OVERRIDE_LIGHTS {
          if (i == 0) {
            light.color = config.overrideLight0;
          } else if (i == 1) {
            light.color = config.overrideLight1;
          } else if (i == 2) {
            light.color = config.overrideLight2;
          } else if (i == 3) {
            light.color = config.overrideLight3;
          }
        }   
        color += calculateLight(light, material, input);
    }

    color += material.color * 0.03 * material.occlusion;
    color = color / (color + float3(1.0));

    if OVERRIDE_COLOR {
        color = material.color;
    } else if DEBUG_NORMALS {
        color = (material.normal);
    } else if DEBUG_TANGENTS {
        color = (input.tangent.xyz);
    } else if DEBUG_METALLIC {
        color = float3(material.metallic);
    } else if DEBUG_ROUGHNESS {
        color = float3(material.roughness);
    } else if DEBUG_OCCLUSION {
        color = float3(material.occlusion);
    } else if DEBUG_TEXCOORDS0 {
        color = float3(input.texCoords0, 1.0);
    }
    return float4(color, 1.0);
}

func calculateLight(light: Light, material: Material, input: FsInput) ->float3 {
    float3 viewDir = normalize(scene.cameraPos - input.wPosition);
    float3 lightColor = light.color.xyz * light.color.w;
    float3 lightDir = normalize(light.position - input.wPosition);
    float3 halfDir = normalize(viewDir + lightDir);

    float lightDistance = length(light.position - input.wPosition);
    float lightAttenuation = 1.0 / (lightDistance * lightDistance);
    float3 lightRadiance = lightColor * lightAttenuation;

    // Correct F0 calculation for PBR
    float3 F0 = lerp(float3(0.04, 0.04, 0.04), material.color.rgb, material.metallic);
    float3 F = fresnelSchlick(max(dot(halfDir, viewDir), 0.0), F0);
    
    float D = distributionGGX(material.normal, halfDir, material.roughness);
    float G = geometrySmith(material.normal, viewDir, lightDir, material.roughness);

    float denom = 4.0 * max(dot(material.normal, viewDir), 0.0) * max(dot(material.normal, lightDir), 0.0) + 0.0001;
    float3 specular = (D * F * G) / denom;

    float3 kS = F;
    float3 kD = float3(1.0) - kS;
    kD *= 1.0 - material.metallic;

    float nDotL = max(dot(material.normal, lightDir), 0.0);

    return (kD * material.color / PI + specular) * lightRadiance * nDotL;
}
Material unpackMaterial(uint index, FsInput vertex) {
  MaterialData materialData = materials.materials[index];
  float2 uv = vertex.texCoords0;

  float3 colorSample = textures[materialData.colorIndex].Sample(uv).rgb;
  if DISABLE_COLOR_MAP {
    colorSample = float3(1.0, 1.0, 1.0);
  }
  float3 normalSample = textures[materialData.normalIndex].Sample(uv).rgb;
  if DISABLE_NORMAL_MAP {
    normalSample = float3(1.0, 1.0, 1.0); // Default normal facing up
  }
  float metalSample = textures[materialData.metalRoughIndex].Sample(uv).b;
  if DISABLE_METAL_ROUGH_MAP {
    metalSample = 1.0; // Default metallic value
  }
  float roughSample = textures[materialData.metalRoughIndex].Sample(uv).g;
  if DISABLE_METAL_ROUGH_MAP {
    roughSample = 1.0; // Default roughness value
  }
  float occlusionSample = textures[materialData.occlusionIndex].Sample(uv).r;
  if DISABLE_OCCLUSION_MAP {
    occlusionSample = 1.0; // Default occlusion value
  }

  Material material;
  float3 tangentNormal = normalize(normalSample * 2.0 - 1.0);
  if (DISABLE_TANGENTS) {
    material.normal = normalize(vertex.normal);
  } else {
    float3 N = normalize(vertex.normal);
    float3 T = normalize(vertex.tangent.xyz);
    float3 B = normalize(cross(N, T) * vertex.tangent.w);
    float3x3 TBN = float3x3(T, B, N);
    material.normal = normalize(mul(tangentNormal, TBN));
  }

  material.color = OVERRIDE_COLOR ? config.overrideColor.rgb : colorSample * materialData.colorFactor;
  material.metallic = OVERRIDE_METALLIC ? config.overrideMetallic : metalSample * materialData.metalFactor;
  material.roughness = OVERRIDE_ROUGHNESS ? config.overrideRoughness : roughSample * materialData.roughFactor;
  material.occlusion = OVERRIDE_OCCLUSION ? config.overrideOcclusion : occlusionSample * materialData.occlusionStrength;

  return material;
}

float distributionGGX(float3 normal, float3 halfDir, float roughness)
{
    float a = max(roughness * roughness, 0.0001);
    float a2 = a * a;
    float nDotH = max(dot(normal, halfDir), 0.0);
    float nDotH2 = nDotH * nDotH;
    float denom = (nDotH2 * (a2 - 1.0) + 1.0);
    denom = PI * denom * denom;
    return a2 / max(denom, 0.0001);
}

float geometrySchlickGGX(float nDotV, float roughness)
{
    float r = (roughness + 1.0);
    float k = (r * r) / 8.0;
    float denom = nDotV * (1.0 - k) + k;
    return nDotV / denom;
}

float geometrySmith(float3 normal, float3 viewDir, float3 lightDir, float roughness)
{
    float nDotV = max(dot(normal, viewDir), 0.0);
    float nDotL = max(dot(normal, lightDir), 0.0);
    float ggx1 = geometrySchlickGGX(nDotV, roughness);
    float ggx2 = geometrySchlickGGX(nDotL, roughness);
    return ggx1 * ggx2;
}

float3 fresnelSchlick(float cosTheta, float3 fresnel0) {
    return fresnel0 + (1.0 - fresnel0) * pow(1.0 - cosTheta, 5.0);
}

struct VsInput
{
    float3 position;
    float uvx;
    float3 normal;
    float uvy;
    float4 tangent;
    float4 color;
};
struct FsInput
{
  float4 position : SV_Position;
  float3 wPosition;
  float3 normal;
  float4 tangent;
  float2 texCoords0;
  float4 color;
};

struct CpuConfig {
    uint flags;
    float overrideMetallic;
    float overrideRoughness;
    float overrideOcclusion;
    float4 overrideColor;
    float4 overrideLight0;
    float4 overrideLight1;
    float4 overrideLight2;
    float4 overrideLight3;
}

struct PushConstants
{
    float4x4 model;
    uint materialIndex;
    uint _padding0;
    uint _padding1;
    uint _padding2;
};

struct Scene {
    float4x4 view;
    float4x4 projection;
    float4x4 vp;
    float3 cameraPos;
    uint n_lights;
    uint padding0;
    uint padding1;
    uint padding2;
    Light lights[4];
};

struct MaterialData {
    uint colorIndex;
    uint normalIndex;
    uint metalRoughIndex;
    uint occlusionIndex;
    float3 colorFactor;
    float metalFactor;
    float roughFactor;
    float occlusionStrength;
}

struct Material {
    float3 color;
    float3 normal;
    float metallic;
    float roughness;
    float occlusion;
}

struct ObjectData {
    MaterialData materials[32];
}

struct Light
{
    float3 position;
    float intensity;
    float4 color;
};
