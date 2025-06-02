static const float PI = 3.1415926535897932384626433832795;

[[vk::binding(0, 0)]]
ConstantBuffer<Scene> scene;
[[vk::binding(1, 0)]]
ConstantBuffer<MaterialBlock> materials;
[[vk::binding(2, 0)]]
Sampler2D textures[]; // Combined image samplers array

struct Light
{
    float3 position;
    float padding1;
    float4 color; 
};

[shader("vertex")]
FsInput vertexMain(VsInput input, uniform PushConstants object)
{
    FsInput output;
    float4 position = mul(float4(input.position, 1.0), object.model);
    float3x3 model = (float3x3)object.model;

    output.position = mul(scene.projection, mul(scene.view, position));
    output.wPosition = position.xyz;
    output.normal = mul(input.normal, model);
    output.tangent = float4(input.tangent.w, mul(input.tangent.xyz, model));
    output.texCoords0 = float2(input.uvx, input.uvy);
    output.color = input.color;
    
    return output;
}

[shader("fragment")]
float4 fragmentMain(FsInput input, uniform PushConstants object) : SV_Target
{
    // Get material data and unpack using combined image samplers
    MaterialData matData = materials.materials[object.materialIndex];
    Material material = unpackMaterial(matData, input, scene.config);
      // Simple lighting calculation
    float3 viewDir = normalize(scene.cameraPos - input.wPosition);
    float3 finalColor = float3(0.0);
    
    // Calculate lighting from all lights
    for (uint i = 0; i < scene.n_lights && i < 4; ++i)
    {
        finalColor += calculateLight(scene.lights[i], material, input.wPosition, viewDir);
    }
    
    // Add ambient
    finalColor += material.color * 0.03 * material.occlusion;
    
    // Simple tone mapping
    finalColor = finalColor / (finalColor + float3(1.0));
    
    return float4(finalColor, 1.0);
}

func calculateLight(light: Light, material: Material, worldPos: float3, viewDir: float3)->float3 {
    float3 lightColor = light.color.xyz * light.color.w;
    float3 lightDir = normalize(light.position - worldPos);
    float3 halfDir = normalize(viewDir + lightDir);

    float lightDistance = length(light.position - worldPos);
    float lightAttenuation = 1.0 / (lightDistance * lightDistance);
    float3 lightRadiance = lightColor * lightAttenuation;

    float3 F = fresnelSchlick(max(dot(halfDir, viewDir), 0.0), float3(0.04, 0.04, 0.04));
    float3 D = distributionGGX(material.normal, halfDir, material.roughness);
    float3 G = geometrySmith(material.normal, viewDir, lightDir, material.roughness);

    float denom = 4.0 * max(dot(material.normal, viewDir), 0.0) * max(dot(material.normal, lightDir), 0.0) + 0.0001;
    float3 specular = (D * F * G) / denom;

    float3 kS = F;
    float3 kD = float3(1.0) - kS;
    kD *= 1.0 - material.metallic;

    float nDotL = max(dot(material.normal, lightDir), 0.0);

    return (kD * material.color / PI + specular) * lightRadiance * nDotL;
}

func unpackMaterial(data: MaterialData, input: FsInput, config: SceneConfig)->Material {
    // float3 colorSample = sampleTexture2D(data.colorIndex, input.texCoords0).rgb;
    float3 colorSample = textures[data.colorIndex].Sample(input.texCoords0).rgb;
    float3 normalSample = textures[data.normalIndex].Sample(input.texCoords0).rgb;
    float3 metalRoughSample = textures[data.metalRoughIndex].Sample(input.texCoords0).rgb;
    float3 occlusionSample = textures[data.occlusionIndex].Sample(input.texCoords0).rgb;
    
    Material material;
    material.color = colorSample * data.colorFactor; // TODO vertex colors
    material.metallic = metalRoughSample.r * data.metalFactor;
    material.roughness = metalRoughSample.g * data.roughFactor;
    material.occlusion = occlusionSample.r * data.occlusionStrength;

    float3 tangentNormal = normalSample * 2.0 - 1.0;
    float3 N = normalize(input.normal);
    float3 T = normalize(input.tangent.xyz);
    float3 B = normalize(cross(N, T)) * input.tangent.w;
    float3x3 TBN = float3x3(T, B, N);
    material.normal = normalize(mul(tangentNormal, TBN));
    
    return material;
}

float3 distributionGGX(float3 normal, float3 halfDir, float roughness)
{
    float3 a = max(roughness * roughness, 0.0001); // Prevent zero roughness
    float3 a2 = a * a;
    float3 nDotH = max(dot(normal, halfDir), 0.0);
    float3 nDotH2 = nDotH * nDotH;
    float3 denom = (nDotH2 * (a2 - 1.0) + 1.0);
    denom = PI * denom * denom;
    return a2 / max(denom, 0.0001); // Prevent division by zero
}

float3 geometrySchlickGGX(float3 nDotV, float3 roughness)
{
    float3 r = (roughness + 1.0);
    float3 k = (r * r) / 8.0;
    float3 denom = nDotV * (1.0 - k) + k;
    return nDotV / denom;
}

float3 geometrySmith(float3 normal, float3 viewDir, float3 lightDir, float3 roughness)
{
    float3 nDotV = max(dot(normal, viewDir), 0.0);
    float3 nDotL = max(dot(normal, lightDir), 0.0);
    float3 ggx1 = geometrySchlickGGX(nDotV, roughness);
    float3 ggx2 = geometrySchlickGGX(nDotL, roughness);
    return ggx1 * ggx2;
}

float3 fresnelSchlick(float3 cosTheta, float3 fresnel0)
{
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
    Light lights[4];
    SceneConfig config;
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

struct MaterialBlock {
    MaterialData materials[10];
}

interface IMaterial {
    func color()->float3;
};

struct SceneConfig
{
    uint disableNormalMap;
    uint forceColor;
    uint forceMetallic;
    uint forceRoughness;
    uint forceOcclusion;
    uint forceDefaults;
    uint debugNormals;
    uint debugTangents;
    uint debugBitangents;
    uint debugRoughness;
    uint debugMetallic;
    uint debugOcclusion;
    uint debugColor;
    uint debugSpecular;
    float3 forceColorFactor;
    float forceMetallicFactor;
    float forceRoughnessFactor;
    float forceAoStrength;
};

// #define DEBUG_COLOR ((scene.config & (1 << 0)) != 0)
// #define DEBUG_NORMALS ((scene.config & (1 << 1)) != 0)
// #define DEBUG_TANGENTS ((scene.config & (1 << 2)) != 0)
// #define DEBUG_METALLIC ((scene.config & (1 << 3)) != 0)
// #define DEBUG_ROUGHNESS ((scene.config & (1 << 4)) != 0)
// #define DEBUG_OCCLUSION ((scene.config & (1 << 5)) != 0)
// #define DEBUG_TEXCOORDS0 ((scene.config & (1 << 6)) != 0)

// #define DEFAULT_COLOR ((scene.config & (1 << 8)) != 0)
// #define DEFAULT_NORMALS ((scene.config & (1 << 9)) != 0)
// #define DEFAULT_TANGENTS ((scene.config & (1 << 10)) != 0)
// #define DEFAULT_METALLIC ((scene.config & (1 << 11)) != 0)
// #define DEFAULT_ROUGHNESS ((scene.config & (1 << 12)) != 0)
// #define DEFAULT_OCCLUSION ((scene.config & (1 << 13)) != 0)

// #define DISABLE_TEXTURES ((scene.config & (1 << 16)) != 0)
// #define DISABLE_LIGHTING ((scene.config & (1 << 17)) != 0)

// const float PI = 3.1415926535897932384626433832795;

// struct Scene {
//   float4x4 view;
//   float4x4 proj;
//   float4x4 viewProj;
//   float3 cameraPos;
//   uint numLights;
//   uint config;
//   uint padding0;
//   uint padding1;
//   uint padding2;
//   Light lights[4];
// };

// struct Material {
//   float3 color;
//   float3 normal;
//   float metallic;
//   float roughness;
//   float occlusion;
// }

// struct MaterialData {
//   uint colorIndex;
//   uint normalIndex;
//   uint metalRoughIndex;
//   uint occlusionIndex;
//   float3 colorFactor;
//   float metalFactor;
//   float roughFactor;
//   float occlusionStrength;
// }

// struct ObjectData {
//   float4x4 transform;
//   uint materialIndex;
// }

// struct Resources {
//   MaterialData materials[32];
// }

// [[vk::binding(0, 0)]]
// ConstantBuffer<Scene> scene;
// [[vk::binding(1, 0)]]
// ConstantBuffer<Resources> resources;
// [[vk::binding(2, 0)]]
// Sampler2D textures[];

// // [[vk::push_constant]]
// // ConstantBuffer<DrawData> drawData;

// struct Light
// {
//   float3 position;
//   float padding1;
//   float4 color;
// };

// struct DrawData
// {
//   float4x4 model;
//   uint materialIndex;
//   uint _padding0;
//   uint _padding1;
//   uint _padding2;
// };

// struct VertexData
// {
//   float3 position;
//   float uvx;
//   float3 normal;
//   float uvy;
//   float4 tangent;
//   float4 color;
// };

// struct Vertex
// {
//   float4 clipPos : SV_Position;
//   float3 worldPos;
//   float3 normal;
//   float4 tangent;
//   float2 texCoords0;
//   float4 color;
// };

// [shader("vertex")]
// Vertex vertexMain(VertexData input, uniform DrawData object)
// {
//   Vertex output;
//   // float4 position = mul(float4(input.position, 1.0), object.model);

//   // output.worldPos = position.xyz;
//   // output.clipPos = mul(position, scene.viewProj);
//   // // output.normal = mul(input.normal, (float3x3)object.model);
//   // output.normal = input.normal; // Assuming input.normal is already in world space
//      output.tangent = mul(input.tangent.xyz, (float3x3)object.model);
//   // output.texCoords0 = float2(input.uvx, input.uvy);
//   // output.color = input.color;

//   // return output;

//   float4 position = mul(object.model, float4(input.position, 1.0));

//   output.worldPos = position.xyz;
//   output.clipPos = mul(mul(scene.view, position), scene.proj);
//   output.normal = mul((float3x3)object.model, input.normal);
//   // output.normal     = normalize(input.normal); // Assuming input.normal is already in world space
//      output.tangent = normalize(input.tangent);
//   output.tangent = float4(mul((float3x3)object.model, input.tangent.xyz), input.tangent.w);
//   output.texCoords0 = float2(input.uvx, input.uvy);
//   output.color = input.color;
//   // output.clipPos    = mul(scene.viewProj, float4(output.worldPos, 1.0));

//   return output;
// }

// [shader("fragment")]
// float4 fragmentMain(Vertex input, uniform DrawData draw) : SV_Target
// {
//   return float4(0.0, 0.0, 0.0, 1.0); // Default color
//   Material material = unpackMaterial(draw.materialIndex, input);

//   float3 viewDir = normalize(scene.cameraPos - input.worldPos);
//   float3 color = float3(0.0);

//   for (uint i = 0; i < scene.numLights && i < 4; ++i)
//     {
//     color += calculateLight(scene.lights[i], material, input.worldPos, viewDir);
//   }

//   color += material.color * 0.03 * material.occlusion;
//   color = color / (color + float3(1.0));

//   if DEBUG_COLOR {
//     color = material.color;
//   } else if DEBUG_NORMALS {
//     color = (input.normal);
//   } else if DEBUG_TANGENTS {
//     color = (input.tangent.xyz);
//   } else if DEBUG_METALLIC {
//     color = float3(material.metallic);
//   } else if DEBUG_ROUGHNESS {
//     color = float3(material.roughness);
//   } else if DEBUG_OCCLUSION {
//     color = float3(material.occlusion);
//   } else if DEBUG_TEXCOORDS0 {
//     color = float3(input.texCoords0, 1.0);
//   }

//   return float4(1.0, 0.0, 0.0, 1.0); // Debug color for visibility
//   return float4(color, 1.0);
// }

// func calculateLight(light: Light, material: Material, worldPos: float3, viewDir: float3) ->float3 {
//   float3 lightColor = light.color.xyz * light.color.w;
//   float3 lightDir = normalize(light.position - worldPos);
//   float3 halfDir = normalize(viewDir + lightDir);

//   float lightDistance = length(light.position - worldPos);
//   float lightAttenuation = 1.0 / (lightDistance * lightDistance);
//   float3 lightRadiance = lightColor * lightAttenuation;

//   float3 F0 = lerp(float3(0.04, 0.04, 0.04), material.color, material.metallic);
//   float3 F = fresnelSchlick(max(dot(halfDir, viewDir), 0.0), F0);
//   float3 D = distributionGGX(material.normal, halfDir, material.roughness);
//   float3 G = geometrySmith(material.normal, viewDir, lightDir, material.roughness);

//   float denom = 4.0 * max(dot(material.normal, viewDir), 0.0) * max(dot(material.normal, lightDir), 0.0) + 0.0001;
//   float3 specular = (D * F * G) / denom;

//   float3 kS = F;
//   float3 kD = float3(1.0) - kS;
//   kD *= 1.0 - material.metallic;

//   float nDotL = max(dot(material.normal, lightDir), 0.0);

//   return (kD * material.color / PI + specular) * lightRadiance * nDotL;
// }

// func unpackMaterial(index: uint, vertex: Vertex)->Material {
//   let materialData = resources.materials[index];
//   let uv = vertex.texCoords0;

//   float3 colorSample = textures[materialData.colorIndex].Sample(uv).rgb;
//   float3 normalSample = textures[materialData.normalIndex].Sample(uv).rgb;
//   float metalSample = textures[materialData.metalRoughIndex].Sample(uv).b;
//   float roughSample = textures[materialData.metalRoughIndex].Sample(uv).g;
//   float occlusionSample = textures[materialData.occlusionIndex].Sample(uv).r;

//   if DISABLE_TEXTURES {
//     colorSample = float3(1.0, 1.0, 1.0);
//     normalSample = float3(1.0, 1.0, 1.0);
//     metalSample = 1.0;
//     roughSample = 1.0;
//     occlusionSample = 1.0;
//   }

//   Material material;
//   material.color = colorSample * materialData.colorFactor; // TODO vertex colors
//   if DEFAULT_COLOR {
//     material.color = float3(1.0, 1.0, 1.0);
//   }

//   float3 tangentNormal = normalize(normalSample * 2.0 - 1.0);
//   float3 N = normalize(vertex.normal);
//   float3 T = normalize(vertex.tangent.xyz);
//   float3 B = normalize(cross(N, T)) * vertex.tangent.w;
//   float3x3 TBN = float3x3(T, B, N);
//   material.normal = normalize(mul(TBN, tangentNormal));
//   if DEFAULT_NORMALS {
//     material.normal = float3(0.0, 0.0, 1.0);
//   }

//   material.metallic = metalSample * materialData.metalFactor;
//   if DEFAULT_METALLIC {
//     material.metallic = 0.95;
//   }

//   material.roughness = roughSample * materialData.roughFactor;
//   if DEFAULT_ROUGHNESS {
//     material.roughness = 0.5;
//   }

//   material.occlusion = occlusionSample * materialData.occlusionStrength;
//   if DEFAULT_OCCLUSION {
//     material.occlusion = 1.0;
//   }

//   return material;
// }

// float3 distributionGGX(float3 normal, float3 halfDir, float roughness)
// {
//   float3 a = max(roughness * roughness, 0.0001);
//   float3 a2 = a * a;
//   float3 nDotH = max(dot(normal, halfDir), 0.0);
//   float3 nDotH2 = nDotH * nDotH;
//   float3 denom = (nDotH2 * (a2 - 1.0) + 1.0);
//   denom = PI * denom * denom;
//   return a2 / max(denom, 0.0001);
// }

// float3 geometrySchlickGGX(float3 nDotV, float3 roughness)
// {
//   float3 r = (roughness + 1.0);
//   float3 k = (r * r) / 8.0;
//   float3 denom = nDotV * (1.0 - k) + k;
//   return nDotV / denom;
// }

// float3 geometrySmith(float3 normal, float3 viewDir, float3 lightDir, float3 roughness)
// {
//   float3 nDotV = max(dot(normal, viewDir), 0.0);
//   float3 nDotL = max(dot(normal, lightDir), 0.0);
//   float3 ggx1 = geometrySchlickGGX(nDotV, roughness);
//   float3 ggx2 = geometrySchlickGGX(nDotL, roughness);
//   return ggx1 * ggx2;
// }

// float3 fresnelSchlick(float3 cosTheta, float3 fresnel0)
// {
//   return fresnel0 + (1.0 - fresnel0) * pow(1.0 - cosTheta, 5.0);
// }
