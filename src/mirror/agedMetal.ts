import { MeshStandardMaterial } from 'three';

type Finish = 'gold' | 'burnished' | 'recess';

/** Uneven surviving gilt over an oxidised casting. Wear is fixed to the object,
 * not to the screen, and changes both the colour and specular lobe. */
export function createAgedMetal(finish: Finish): MeshStandardMaterial {
  const settings = {
    gold: { color: '#b39966', metalness: .88, roughness: .32, envMapIntensity: 1.12 },
    burnished: { color: '#d5bc83', metalness: .95, roughness: .23, envMapIntensity: 1.20 },
    recess: { color: '#65543a', metalness: .72, roughness: .53, envMapIntensity: .85 },
  };
  const material = new MeshStandardMaterial(settings[finish]);
  material.onBeforeCompile = shader => {
    shader.vertexShader = `varying vec3 vCastPosition;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCastPosition = position;');
    shader.fragmentShader = /* glsl */ `
      varying vec3 vCastPosition;
      float castHash(vec3 p) {
        p = fract(p * .1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }
      float castNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(castHash(i), castHash(i + vec3(1,0,0)), f.x),
                       mix(castHash(i + vec3(0,1,0)), castHash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(castHash(i + vec3(0,0,1)), castHash(i + vec3(1,0,1)), f.x),
                       mix(castHash(i + vec3(0,1,1)), castHash(i + vec3(1)), f.x), f.y), f.z);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', /* glsl */ `
        #include <color_fragment>
        vec3 castP = vCastPosition;
        float casting = castNoise(castP * 380.0);
        float stipple = castNoise(castP * 2100.0);
        float oxide = smoothstep(.32, .72,
          castNoise(castP * 85.0) * .57 + casting * .30 + stipple * .13);
        // Raised details retain rubbed gold; the relief's valleys collect oxide.
        float reliefWear = smoothstep(.002, .007, castP.z);
        oxide *= mix(1.0, .56, reliefWear);
        oxide = clamp(oxide * ${finish === 'recess' ? '1.45' : finish === 'burnished' ? '.53' : '1.0'}, 0.0, 1.0);
        vec3 darkBronze = vec3(.065, .045, .022);
        diffuseColor.rgb = mix(diffuseColor.rgb, darkBronze, oxide * .82);
        diffuseColor.rgb *= .91 + .15 * stipple;
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
        #include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + oxide * .29 + (stipple - .5) * .09, .16, .84);
      `)
      .replace('#include <normal_fragment_maps>', /* glsl */ `
        #include <normal_fragment_maps>
        // Micrometre-scale casting pores, evaluated with a surface gradient.
        // Derivatives antialias this relief without a screen-space noise layer.
        float poreHeight = (stipple * .75 + casting * .25) * .000014;
        vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
        vec3 rx = cross(sy, normal), ry = cross(normal, sx);
        float determinant = dot(sx, rx);
        vec3 slope = sign(determinant) * (dFdx(poreHeight) * rx + dFdy(poreHeight) * ry);
        normal = normalize(abs(determinant) * normal - slope);
      `);
  };
  material.customProgramCacheKey = () => `aged-gilt-v1-${finish}`;
  return material;
}
