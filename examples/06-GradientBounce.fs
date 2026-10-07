/*{
  "ISFVSN": "2",
  "DESCRIPTION": "Two colours that bounce across the stage, with a soft edge. An example of a custom ISF shader for openLedMapper: add it with + Add > ISF shader file (.fs)… above the source list. Its inputs become the controls in the Content tab.",
  "CREDIT": "openLedMapper examples",
  "CATEGORIES": ["Generator", "gradient", "lively"],
  "INPUTS": [
    { "NAME": "colorA", "LABEL": "Colour A", "TYPE": "color", "DEFAULT": [1.0, 0.25, 0.1, 1.0] },
    { "NAME": "colorB", "LABEL": "Colour B", "TYPE": "color", "DEFAULT": [0.1, 0.4, 1.0, 1.0] },
    { "NAME": "speed", "LABEL": "Speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 3.0 },
    { "NAME": "softness", "LABEL": "Softness", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.01, "MAX": 1.0 },
    { "NAME": "angle", "LABEL": "Angle", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 360.0 },
    { "NAME": "mirror", "LABEL": "Mirror", "TYPE": "bool", "DEFAULT": false }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord - 0.5;
  float a = radians(angle);
  float x = dot(uv, vec2(cos(a), sin(a))) + 0.5;      // 0 to 1 along the angle
  if (mirror) x = 1.0 - abs(2.0 * x - 1.0);
  float edge = 0.5 + 0.45 * sin(TIME * speed * 3.14159);   // where the two colours meet, bouncing
  float t = smoothstep(edge - softness * 0.5, edge + softness * 0.5, x);
  gl_FragColor = mix(colorA, colorB, t);
}
