
const float PI = 3.1415926535897932384626433832795;

bool debugThrottleFrag() {
    vec4 v = gl_FragCoord;
    return (v.x > 900 && v.x < 901 && v.y > 500 && v.y < 501);
}