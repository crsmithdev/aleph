#version 450

#define DEBUG_ENABLED true
#define DEBUG_FRAG_THROTTLE (vec3 v = gl_FragCoord; v.x > 630.0 && v.x < 631.0 && v.y > 400.0 && v.y < 401.0)
#define DEBUG_FRAG DEBUG_ENABLED && !DEBUG_FRAG_THROTTLE

#define DEBUG_VERTEX_THROTTLE (gl_VertexIndex == 0)
#define DEBUG_VERTEX DEBUG_ENABLED && !DEBUG_VERTEX_THROTTLE