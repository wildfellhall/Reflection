export const mirrorVertex = /* glsl */ `
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vLocalPosition;
void main() {
  vLocalPosition = position;
  vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPosition, 1.0);
}
`;

export const mirrorFragment = /* glsl */ `
precision highp float;
uniform sampler2D uVideo;
uniform sampler2D uEnvironment;
uniform sampler2D uBackingMap;
uniform sampler2D uGlassMap;
uniform vec2 uMaterialTexel;
uniform float uLive;
uniform float uLayer;
uniform float uIOR;
uniform float uViewDistance;
uniform float uEnvironmentRotation;
uniform float uEnvironmentExposure;
uniform float uCameraIntegration;
uniform float uCameraExposure;
uniform float uCameraSaturation;
uniform float uFaceMetalness;
uniform float uFaceContour;
uniform float uAntique;
uniform float uStudioStrength;
uniform vec2 uStudioShift;
uniform vec2 uSize;
uniform vec2 uVideoSize;
uniform vec3 uAbsorption;
uniform vec3 uSilver;
uniform vec3 uChromeN;
uniform vec3 uChromeK;
uniform mat3 uWorldRotation;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vLocalPosition;

vec3 videoColor(vec2 uv, float lod) {
  // Prepared once per frame in CameraRadiance. Filtering now averages linear
  // light, and each reflection lobe can request its own image footprint.
  vec3 c = textureLod(uVideo, clamp(uv, vec2(.001), vec2(.999)), lod).rgb;
  return mix(vec3(dot(c, vec3(.2126, .7152, .0722))), c, uCameraSaturation);
}

vec3 environmentColor(vec3 direction, float blur) {
  vec3 d = normalize(direction);
  float rotation = uEnvironmentRotation;
  float c = cos(rotation), s = sin(rotation);
  d.xz = mat2(c, -s, s, c) * d.xz;
  vec2 uv = vec2(atan(d.z, d.x) * .159154943 + .5, asin(clamp(d.y, -1.0, 1.0)) * .318309886 + .5);
  // Explicit LOD keeps material-map derivatives from spuriously changing the
  // environment blur. The reflection lobe below supplies the angular spread.
  return textureLod(uEnvironment, uv, blur + uStudioStrength * .8).rgb * uEnvironmentExposure;
}

vec3 softenReflection(vec3 radiance) {
  // A smooth highlight shoulder softens the captured lighting. Apply it
  // to the combined field so camera and environment share the same response.
  // Darker reflected detail stays intact; the frame has its own material.
  float luminance = dot(radiance, vec3(.2126, .7152, .0722));
  float excess = max(luminance - .55, 0.0);
  float softened = min(luminance, .55) + excess / (1.0 + excess / .80);
  radiance *= mix(1.0, softened / max(luminance, .00001), uStudioStrength);
  return radiance;
}

vec3 sceneRadiance(vec3 origin, vec3 direction, float blur, float liveWeight, float liveLod) {
  vec3 env = environmentColor(direction, blur);
  // Use the captured HDR for unobserved directions and the camera-off glass.
  // No painted backdrop or synthetic vertical colour ramp covers the pane.
  env = mix(env, vec3(dot(env, vec3(.2126, .7152, .0722))), .86 * uStudioStrength);
  if (uLive < .5 || direction.z <= .025) return softenReflection(env);
  // A finite image plane approximates the observed room. Surface and coating
  // lobes resolve different parts of that field, at their own ray intersections.
  float sceneDepth = mix(1.2, .45, uAntique);
  vec3 hit = origin + direction * max(0.0, (sceneDepth - origin.z) / direction.z);
  hit.xy += sceneDepth * cameraPosition.xy / uViewDistance;
  float viewScale = 1.0 + sceneDepth / uViewDistance;
  float aspect = uVideoSize.x / max(uVideoSize.y, 1.0);
  float imageHeight = uSize.y * viewScale;
  float imageWidth = imageHeight * aspect;
  if (aspect < uSize.x / uSize.y) {
    imageWidth = uSize.x * viewScale;
    imageHeight = imageWidth / aspect;
  }
  vec2 uv = hit.xy / vec2(imageWidth, imageHeight) + .5;
  float border = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  float confidence = smoothstep(0.0, .055, border) * smoothstep(.025, .15, direction.z);
  uv.x = 1.0 - uv.x;
  vec3 live = videoColor(uv, liveLod) * uCameraExposure;
  // The captured environment supplies lighting unavailable to a webcam.
  // Restrain resolved image contrast under its brightest reflections. This is
  // explicit art direction, not a physical property of silver or camera opacity.
  float envLuminance = dot(env, vec3(.2126, .7152, .0722));
  float highlightReserve = mix(1.0, .48, smoothstep(.45, 1.1, envLuminance) * uStudioStrength);
  const float blackFloor = .035;
  vec3 radiance = exp(mix(log(env + blackFloor), log(live + blackFloor),
    confidence * uCameraIntegration * liveWeight * highlightReserve)) - blackFloor;
  return softenReflection(radiance);
}

float dielectricFresnel(float cosine, float etaI, float etaT) {
  float c = clamp(cosine, 0.0, 1.0);
  float sin2 = pow(etaI / etaT, 2.0) * (1.0 - c * c);
  if (sin2 >= 1.0) return 1.0;
  float ct = sqrt(1.0 - sin2);
  float rs = (etaI * c - etaT * ct) / max(etaI * c + etaT * ct, .00001);
  float rp = (etaT * c - etaI * ct) / max(etaT * c + etaI * ct, .00001);
  return .5 * (rs * rs + rp * rp);
}

vec3 conductorFresnel(float cosine) {
  float c = max(cosine, .0001), c2 = c * c, s2 = 1.0 - c2;
  vec3 n2 = uChromeN * uChromeN, k2 = uChromeK * uChromeK;
  vec3 t0 = n2 - k2 - s2;
  vec3 a2b2 = sqrt(t0 * t0 + 4.0 * n2 * k2);
  vec3 a = sqrt(.5 * (a2b2 + t0));
  vec3 t1 = a2b2 + c2, t2 = 2.0 * c * a;
  vec3 rs = (t1 - t2) / (t1 + t2);
  vec3 t3 = c2 * a2b2 + s2 * s2, t4 = t2 * s2;
  vec3 rp = rs * (t3 - t4) / (t3 + t4);
  return .5 * (rs + rp);
}

vec3 polishedRadiance(vec3 origin, vec3 ray) {
  vec3 tangent = normalize(cross(ray, abs(ray.y) < .95 ? vec3(0, 1, 0) : vec3(1, 0, 0)));
  vec3 bitangent = cross(ray, tangent);
  // Tight cone for polished chromium; no clearcoat or added white outline.
  const float spread = .0035;
  vec3 sum = sceneRadiance(origin, ray, .75, 1.0, 0.0) * .4;
  sum += sceneRadiance(origin, normalize(ray + tangent * spread), .75, 1.0, 0.0) * .15;
  sum += sceneRadiance(origin, normalize(ray - tangent * spread), .75, 1.0, 0.0) * .15;
  sum += sceneRadiance(origin, normalize(ray + bitangent * spread), .75, 1.0, 0.0) * .15;
  sum += sceneRadiance(origin, normalize(ray - bitangent * spread), .75, 1.0, 0.0) * .15;
  return sum;
}

// Energy-normalized core and scattering shoulder. Both follow the coating's
// normals; the shoulder loses fine live detail through the radiance pyramid.
// This finite-cone approximation is not a full layered microfacet BSDF.
vec3 roughRadiance(vec3 origin, vec3 ray, float roughness, float liveWeight) {
  if (roughness < .012) return sceneRadiance(origin, ray, 0.0, liveWeight, 0.0);
  vec3 tangent = normalize(cross(ray, abs(ray.y) < .95 ? vec3(0, 1, 0) : vec3(1, 0, 0)));
  vec3 bitangent = cross(ray, tangent);
  float spread = roughness * roughness * 1.8;
  float lod = roughness * 8.0;
  // Intact polish retains a sharp specular core. Tarnish transfers more of
  // that energy to the broad lobe, rather than frosting the whole reflection.
  float core = mix(.62, .2, smoothstep(.04, .22, roughness));
  float resolved = liveWeight * mix(1.0, .30, smoothstep(.04, .22, roughness));
  float scatterLod = max(2.0, log2(max(1.0, spread * min(uVideoSize.y, 1024.0) * 1.5)));
  vec3 sum = sceneRadiance(origin, ray, lod, resolved, roughness * 3.0) * core;
  for (int i = 0; i < 8; i++) {
    float angle = float(i) * .785398163;
    vec3 offset = (cos(angle) * tangent + sin(angle) * bitangent) * spread;
    sum += sceneRadiance(origin, normalize(ray + offset), lod, liveWeight * .18, scatterLod) * ((1.0 - core) / 8.0);
  }
  return sum;
}

vec4 backingAt(vec2 position) {
  return texture2D(uBackingMap, position / uSize + .5);
}

vec3 backingNormal(vec2 position, vec3 planeNormal) {
  vec2 uv = position / uSize + .5;
  float left = texture2D(uBackingMap, uv - vec2(uMaterialTexel.x, 0)).a;
  float right = texture2D(uBackingMap, uv + vec2(uMaterialTexel.x, 0)).a;
  float down = texture2D(uBackingMap, uv - vec2(0, uMaterialTexel.y)).a;
  float up = texture2D(uBackingMap, uv + vec2(0, uMaterialTexel.y)).a;
  // Submicron deposition relief affects the reflected ray, not a bright outline.
  vec2 slope = vec2(right - left, up - down) * .0000005 / (2.0 * uMaterialTexel * uSize);
  return normalize(planeNormal - uWorldRotation * vec3(slope, 0));
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 backNormal = normalize(uWorldRotation * vec3(0, 0, 1));
  float face = smoothstep(.985, .9995, dot(N, backNormal));
  vec4 surface = uAntique > .5 ? texture2D(uGlassMap, vLocalPosition.xy / uSize + .5) : vec4(0);
  N = normalize(N - uWorldRotation * vec3(surface.xy, 0) * face);
  if (uLayer < .5) {
    // A broad, smooth normal contour gives the interior the same bending
    // reflections that make the rounded chrome readable. This is a surface
    // shading treatment; the glass silhouette and physical bevel stay intact.
    vec2 p = vLocalPosition.xy / (uSize * .5);
    vec2 slope = vec2(.12 * p.x * p.x * p.x + .09 * p.x * p.y * p.y,
                     .09 * p.x * p.x * p.y + .10 * p.y * p.y * p.y);
    N = normalize(N + uWorldRotation * vec3(slope, 0) * uFaceContour * face);
  }
  vec3 V = normalize(cameraPosition - vWorldPosition);
  vec3 I = -V;
  vec3 reflected = reflect(I, N);
  float cosine = max(dot(N, V), .00001);
  vec3 color;
  if (uLayer > .5) {
    color = conductorFresnel(cosine) * polishedRadiance(vWorldPosition, reflected);
  } else {
    float entryF = dielectricFresnel(cosine, 1.0, uIOR);
    vec3 frontPoint = vWorldPosition + backNormal * surface.w * face;
    vec3 inside = refract(I, N, 1.0 / uIOR);
    float toBack = max(vLocalPosition.z + surface.w * face, .0001) / max(-dot(inside, backNormal), .05);
    vec3 backPoint = frontPoint + inside * toBack;
    vec3 backLocal = vLocalPosition + (inside * uWorldRotation) * toBack;
    vec4 coating = uAntique > .5 ? backingAt(backLocal.xy) : vec4(0);
    vec3 silverNormal = uAntique > .5 ? backingNormal(backLocal.xy, backNormal) : backNormal;
    vec3 returning = reflect(inside, silverNormal);
    // Intersect the return with the local front facet: the bevel changes both
    // the entry AND exit rays. This is not a normal-only rim over a flat video.
    float toFront = max(dot(frontPoint - backPoint, N), 0.0) / max(dot(returning, N), .05);
    vec3 exitPoint = backPoint + returning * toFront;
    float exitF = dielectricFresnel(max(dot(returning, N), 0.0), uIOR, 1.0);
    vec3 exiting = refract(returning, -N, uIOR);
    vec3 absorption = exp(-uAbsorption * (toBack + toFront));
    vec2 wear = coating.rg;
    vec3 backing = uSilver * absorption * mix(vec3(1), vec3(.42, .37, .28), wear.y * .72);
    vec3 weight = (1.0 - entryF) * (1.0 - exitF) * backing;
    // The weak dielectric glint keeps its own fine normals and image response.
    // It remains present even where the rear silver has completely disappeared.
    vec3 frontLight = roughRadiance(frontPoint, reflected, surface.z, .08);
    vec3 backLight = exitF < .999 ? roughRadiance(exitPoint, normalize(exiting), coating.b, 1.0) : vec3(0);

    // Trace one more internal return to a new rear-coating position. This adds
    // a restrained displaced return at the bevel and during tilt, instead of
    // duplicating the first ray at identical UVs. Higher orders share this exit.
    vec3 secondInside = reflect(returning, N);
    float secondToBack = max(dot(exitPoint - backPoint, backNormal), .0001)
      / max(-dot(secondInside, backNormal), .05);
    vec3 secondBack = exitPoint + secondInside * secondToBack;
    vec3 secondLocal = backLocal + ((secondBack - backPoint) * uWorldRotation);
    vec4 secondCoating = uAntique > .5 ? backingAt(secondLocal.xy) : vec4(0);
    vec3 secondNormal = uAntique > .5 ? backingNormal(secondLocal.xy, backNormal) : backNormal;
    vec3 secondReturning = reflect(secondInside, secondNormal);
    float secondToFront = max(dot(frontPoint - secondBack, N), 0.0) / max(dot(secondReturning, N), .05);
    vec3 secondExit = secondBack + secondReturning * secondToFront;
    float secondF = dielectricFresnel(max(dot(secondReturning, N), 0.0), uIOR, 1.0);
    vec3 secondRay = refract(secondReturning, -N, uIOR);
    vec3 secondBacking = uSilver * exp(-uAbsorption * (secondToBack + secondToFront))
      * mix(vec3(1), vec3(.42, .37, .28), secondCoating.g * .72) * (1.0 - secondCoating.r);
    vec3 secondWeight = (1.0 - entryF) * backing * exitF * (1.0 - secondF) * secondBacking
      / max(vec3(.001), 1.0 - secondF * secondBacking);
    vec3 secondLight = secondF < .999 ? roughRadiance(secondExit, normalize(secondRay),
      max(coating.b, secondCoating.b), .65) : vec3(0);
    // Exposed protective backing receives diffuse environmental illumination.
    // With no incident light, it returns zero rather than emitting brown pixels.
    vec3 backingLight = environmentColor(backNormal, 8.0);
    vec3 darkBacking = mix(vec3(.009, .007, .005), vec3(.026, .022, .015), coating.a) * backingLight;
    vec3 exposed = (1.0 - entryF) * (1.0 - exitF) * absorption * darkBacking;
    color = entryF * frontLight + (1.0 - wear.x) * (weight * backLight + secondWeight * secondLight) + wear.x * exposed;
    // Carry the chromium conductor response onto the broad inner face, while
    // leaving the cut bevel as glass. This is a deliberate polished-metal
    // finish blend rather than a claim that ordinary glass is chromium.
    vec3 metal = conductorFresnel(cosine) * backLight * mix(vec3(1), vec3(.72, .68, .57), wear.y);
    color = mix(color, (1.0 - wear.x) * metal + wear.x * (entryF * frontLight + exposed),
      uFaceMetalness * face);
    if (uAntique > .5) color *= vec3(1.0, .995, .978);
  }
  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

