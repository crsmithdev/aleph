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

bool debugThrottleFrag() {
    vec4 v = gl_FragCoord;
    float delta_x = abs(v.x - 640.0);
    float delta_y = abs(v.y - 360.0);
    return delta_x < 1.0 && delta_y < 1.0; 
}