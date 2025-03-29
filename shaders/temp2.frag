#version 450
layout (std140, binding = 0) uniform GpuDrawData {
    mat4 model;
    mat4 view;
    mat4 projection;
    mat4 model_view;
    mat4 view_projection;
    mat4 model_view_projection; 
    mat4 world_transform;
    mat4 viedw_inverse;
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

layout (location = 0) in vec3 in_pos;
layout (location = 1) in vec3 in_normal;
layout (location = 2) in vec3 in_normal_derived;
layout (location = 3) in vec2 in_uv;
layout (location = 4) in vec3 in_color;

layout (location = 0) out vec4 out_color;

// Define INPUTS from fragment shader
//uniform mat4 view_mat;
// These come from the VAO for texture coordinates.
const vec3 lightPos = vec3(0.0,0.0,5.0);
const vec3 diffColor = vec3(1.0,0.5,0.0);
const vec3 specColor = vec3(1.0,1.0,1.0);

void main () {
    vec3 normal = in_normal;
    vec3 lightDir = normalize(lightPos - in_pos);
    float lamb = max(dot(lightDir, normal), 0.0);
    float spec = 0.0;

    if (lamb > 0.0) {
        vec3 refDir = reflect(-lightDir, normal);
        vec3 viewDir = normalize(-in_pos);

        float specAngle = max(dot(refDir, viewDir), 0.0);
        spec = pow(specAngle, 4.0);
    }

  out_color = vec4(lamb * diffColor + spec * specColor, 1.0);
}

// GLfloat normals[49 * 49 * 18];
// curr = 0;
// for (int i = 0; i < 49 * 49 * 18; i += 9){
//     float Ux = vp[i+3] - vp[i];
//     float Uy = vp[i+4] - vp[i+1];
//     float Uz = vp[i+5] - vp[i+2];
//     float Vx = vp[i+6] - vp[i];
//     float Vy = vp[i+7] - vp[i+1];
//     float Vz = vp[i+8] - vp[i+2];

//     float nx = Uy * Vz - Uz * Vy;
//     float ny = Uz * Vx - Ux * Vz;
//     float nz = Ux * Vy - Uy * Vx;

//     for (int j = 0; j < 3; ++j) {
//         normals[curr++] = nx;
//         normals[curr++] = ny;
//         normals[curr++] = nz;
//     }
// }
// glBufferData(GL_ARRAY_BUFFER, 49 * 49 * 18 * sizeof(GLfloat), normals, GL_STATIC_DRAW);
// I recommend to invert the normal vector of the back faces for a double sided light model:

// vec3 normal = normalize(Normal);
// vec3 viewDir = normalize(-fpos);
// if (dot(normal, viewDir) < 0.0)
//     normal *= -1.0;



// // Define INPUTS from fragment shader
// //uniform mat4 view_mat;
// in vec3 Normal;
// in vec3 fpos;

// // These come from the VAO for texture coordinates.
// in vec2 texture_coords;

// // And from the uniform outputs for the textures setup in main.cpp.
// uniform sampler2D texture00;
// uniform sampler2D texture01;

// out vec4 fragment_color; //RGBA color

// const vec3 lightPos = vec3(0.0,0.0,5.0);
// const vec3 diffColor = vec3(1.0,0.5,0.0);
// const vec3 specColor = vec3(1.0,1.0,1.0);

// void main () {
//     vec3 normal = normalize(Normal);
//     vec3 viewDir = normalize(-fpos);
//     if (dot(normal, viewDir) < 0.0)
//         normal *= -1.0;
  
//     vec3 lightDir = normalize(lightPos - fpos);
//     float lamb = max(dot(lightDir, normal), 0.0);
//     float spec = 0.0;

//     if (lamb > 0.0) {
//         vec3 refDir = reflect(-lightDir, normal);

//         float specAngle = max(dot(refDir, viewDir), 0.0);
//         spec = pow(specAngle, 4.0);
//     }

//     fragment_color = vec4(lamb * diffColor + spec * specColor, 1.0);
// }
// // Define INPUTS from fragment shader
// //uniform mat4 view_mat;
// // in vec3 Normal;
// // in vec3 fpos;

// // These come from the VAO for texture coordinates.
// // in vec2 texture_coords;

// // And from the uniform outputs for the textures setup in main.cpp.
// // uniform sampler2D texture00;
// // uniform sampler2D texture01;

// layout(location = 0) out vec4 out_color;
// // out vec4 fragment_color; //RGBA color

// const vec3 lightPos = vec3(0.0,0.0,5.0);
// const vec3 diffColor = vec3(1.0,0.5,0.0);
// const vec3 specColor = vec3(1.0,1.0,1.0);

// void main () {
//     vec3 normal = normalize(in_normal);
//     vec3 viewDir = normalize(-in_world_pos);
//     if (dot(normal, viewDir) < 0.0)
//         normal *= -1.0;
  
//     vec3 lightDir = normalize(lightPos - in_world_pos);
//     float lamb = max(dot(lightDir, normal), 0.0);
//     float spec = 0.0;

//     if (lamb > 0.0) {
//         vec3 refDir = reflect(-lightDir, normal);

//         float specAngle = max(dot(refDir, viewDir), 0.0);
//         spec = pow(specAngle, 4.0);
//     }

//     out_color = vec4(lamb * diffColor + spec * specColor, 1.0);
// }