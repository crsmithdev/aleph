static const float PI = 3.1415926535897932384626433832795;

#define DEBUG_COLOR ((config.flags & (1 << 0)) != 0)
#define DEBUG_NORMALS ((config.flags & (1 << 1)) != 0)
#define DEBUG_TANGENTS ((config.flags & (1 << 2)) != 0)
#define DEBUG_METALLIC ((config.flags & (1 << 3)) != 0)
#define DEBUG_ROUGHNESS ((config.flags & (1 << 4)) != 0)
#define DEBUG_OCCLUSION ((config.flags & (1 << 5)) != 0)
#define DEBUG_TEXCOORDS0 ((config.flags & (1 << 6)) != 0)
#define OVERRIDE_COLOR ((config.flags & (1 << 8)) != 0)
#define OVERRIDE_LIGHTS ((config.flags & (1 << 9)) != 0)
#define OVERRIDE_TANGENTS ((config.flags & (1 << 10)) != 0)
#define OVERRIDE_METALLIC ((config.flags & (1 << 11)) != 0)
#define OVERRIDE_ROUGHNESS ((config.flags & (1 << 12)) != 0)
#define OVERRIDE_OCCLUSION ((config.flags & (1 << 13)) != 0)
#define DISABLE_TEXTURES ((config.flags & (1 << 16)) != 0)
#define DISABLE_TANGENTS ((config.flags & (1 << 17)) != 0)

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

    output.position = mul(mul(position, scene.view), scene.projection);
    output.wPosition = position.xyz;
    output.normal = normalize(mul(input.normal, model));
    output.tangent = float4(mul(input.tangent.xyz, model), input.tangent.w);
    output.texCoords0 = float2(input.uvx, input.uvy);
    output.color = input.color;
    
    return output;
}

[shader("fragment")]
float4 fragmentMain(FsInput input, uniform PushConstants object) : SV_Target
{

    Material material = unpackMaterial(object.materialIndex, input);


    float3 viewDir = normalize(scene.cameraPos - input.wPosition);
    float3 color = material.color * 0.5; // Start with just albedo

    for (uint i = 0; i < scene.n_lights; ++i) {
        color += calculateBlinnPhong(scene.lights[i], material, input);
    }

    return float4(color, 1.0);
}

float3 calculateBlinnPhong(Light light, Material material, FsInput input) {
    float3 viewDir = normalize(scene.cameraPos - input.wPosition);
    float3 lightDir = normalize(light.position - input.wPosition);
    float3 halfDir = normalize(viewDir + lightDir);

    float nDotL = saturate(dot(material.normal, lightDir));
    float nDotH = saturate(dot(material.normal, halfDir));

    float shininess = lerp(1.0, 128.0, 1.0 - material.roughness);
    float specularStrength = pow(nDotH, shininess);

    return material.color * light.color.xyz * (nDotL + specularStrength);
}

float3 visualizeNormal(FsInput input, Material material) : SV_Target
{
    float3 viewNormal = normalize(mul(scene.view, float4(material.normal, 0.0)).xyz);
    return viewNormal * 0.5 + 0.5;
}


Material unpackMaterial(uint index, FsInput vertex) {
    MaterialData materialData = materials.materials[index];
    float2 uv = vertex.texCoords0;

    float3 colorSample = textures[materialData.colorIndex].Sample(uv).rgb;
    float3 normalSample = textures[materialData.normalIndex].Sample(uv).rgb;
    float metalSample = textures[materialData.metalRoughIndex].Sample(uv).b;
    float roughSample = textures[materialData.metalRoughIndex].Sample(uv).g;
    float occlusionSample = textures[materialData.occlusionIndex].Sample(uv).r;

    if (DISABLE_TEXTURES) {
        colorSample = float3(1.0, 1.0, 1.0);
        normalSample = float3(0.5, 0.5, 1.0);
        metalSample = 0.0;
        roughSample = 1.0;
        occlusionSample = 1.0;
    }

    Material material;
    material.color = OVERRIDE_COLOR ? config.overrideColor.rgb : colorSample * materialData.colorFactor;

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

    material.metallic = OVERRIDE_METALLIC ? config.overrideMetallic : metalSample * materialData.metalFactor;
    material.roughness = OVERRIDE_ROUGHNESS ? config.overrideRoughness : roughSample * materialData.roughFactor;
    material.occlusion = OVERRIDE_OCCLUSION ? config.overrideOcclusion : occlusionSample * materialData.occlusionStrength;

    return material;
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
