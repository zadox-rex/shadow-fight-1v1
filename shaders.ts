import * as THREE from 'three';

export interface SilhouetteUniforms {
  [uniform: string]: THREE.IUniform<unknown>;
  uBaseColor: THREE.IUniform<THREE.Color>;
  uRimColor: THREE.IUniform<THREE.Color>;
  uRimPower: THREE.IUniform<number>;
  uRimIntensity: THREE.IUniform<number>;
  uHitFlash: THREE.IUniform<number>;
  uShadowAura: THREE.IUniform<number>;
  uBlocking: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
}

export function createSilhouetteShaderMaterial(rimColorHex: number): THREE.ShaderMaterial {
  const uniforms: SilhouetteUniforms = {
    uBaseColor: { value: new THREE.Color(0x050505) },
    uRimColor: { value: new THREE.Color(rimColorHex) },
    uRimPower: { value: 2.25 },
    uRimIntensity: { value: 1.95 },
    uHitFlash: { value: 0.0 },
    uShadowAura: { value: 0.0 },
    uBlocking: { value: 0.0 },
    uTime: { value: 0.0 },
  };

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec3 vWorldPos;

      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBaseColor;
      uniform vec3 uRimColor;
      uniform float uRimPower;
      uniform float uRimIntensity;
      uniform float uHitFlash;
      uniform float uShadowAura;
      uniform float uBlocking;
      uniform float uTime;

      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec3 vWorldPos;

      void main() {
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(vViewPosition);

        float ndotv = clamp(dot(viewDir, normal), 0.0, 1.0);
        float fresnel = pow(1.0 - ndotv, uRimPower);
        float outerEdge = smoothstep(0.32, 0.92, 1.0 - ndotv);

        // Animated shadow energy ripple along the rim when charged or in Ultimate
        float wave = 0.85 + 0.15 * sin(vWorldPos.y * 8.0 - uTime * 9.0);
        float crackle = 0.85 + 0.25 * sin(vWorldPos.y * 18.0 + vWorldPos.x * 11.0 - uTime * 22.0);
        float auraBoost = 1.0 + uShadowAura * 1.25 * wave * mix(1.0, crackle, step(0.9, uShadowAura));

        // Crisp glowing rim light + warm dusk edge sheen
        float backRim = (smoothstep(0.0, 0.78, fresnel) * uRimIntensity + outerEdge * 0.42) * auraBoost;

        vec3 col = uBaseColor + uRimColor * backRim + vec3(1.0, 0.68, 0.46) * outerEdge * 0.16;
        if (uShadowAura > 0.95) {
          col += uRimColor * pow(fresnel, 1.6) * 0.7 * crackle;
        }

        // Defensive block ward sheen
        if (uBlocking > 0.01) {
          float ward = pow(1.0 - ndotv, 1.8) * uBlocking;
          col += mix(uRimColor, vec3(0.85, 0.95, 1.0), 0.5) * ward * 0.9;
        }

        // Impact hit-flash
        col = mix(col, vec3(1.0, 0.96, 0.9), clamp(uHitFlash, 0.0, 1.0));

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

export function createTwilightSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uEclipse: { value: 0 },
      uFinisher: { value: 0 },
      uTopColor: { value: new THREE.Color(0x070614) },
      uMidColor: { value: new THREE.Color(0x28123c) },
      uHorizonColor: { value: new THREE.Color(0xb83c4e) },
      uGlowColor: { value: new THREE.Color(0xff9b6a) },
      uSunDir: { value: new THREE.Vector3(0.0, 0.24, -1.0).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(worldPos.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uEclipse;
      uniform float uFinisher;
      uniform vec3 uTopColor;
      uniform vec3 uMidColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uGlowColor;
      uniform vec3 uSunDir;

      varying vec3 vWorldDir;

      void main() {
        vec3 dir = normalize(vWorldDir);
        float h = clamp(dir.y, -0.2, 1.0);

        // Multi-stop twilight gradient
        vec3 sky = mix(uHorizonColor, uMidColor, smoothstep(-0.02, 0.28, h));
        sky = mix(sky, uTopColor, smoothstep(0.24, 0.78, h));

        // Blood-moon / Dusk sun disc & atmospheric halo
        float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
        float sunDisc = smoothstep(0.992, 0.9945, sunDot);
        float innerHalo = pow(sunDot, 22.0) * 0.65;
        float wideHalo = pow(sunDot, 4.5) * 0.35;

        sky += uGlowColor * (wideHalo + innerHalo);
        sky = mix(sky, vec3(1.0, 0.86, 0.72), sunDisc * 0.95);

        // Subtle drifting twilight mist bands near horizon
        float mistBand = exp(-abs(h - 0.04) * 14.0) * (0.14 + 0.04 * sin(dir.x * 6.0 + uTime * 0.3));
        sky += uGlowColor * mistBand;

        // Ultimate Shadow Eclipse darkening & crimson/violet corona flare
        if (uEclipse > 0.001) {
          vec3 eclipseSky = sky * mix(1.0, 0.22, uEclipse);
          float corona = pow(sunDot, 14.0) * uEclipse * 0.85;
          eclipseSky += vec3(0.65, 0.12, 0.38) * corona;
          eclipseSky = mix(eclipseSky, vec3(0.03, 0.01, 0.06), sunDisc * uEclipse * 0.92);
          sky = eclipseSky;
        }

        // High-Contrast Slow-Motion Silhouette Finisher Mode
        if (uFinisher > 0.001) {
          vec3 silhouetteBg = mix(vec3(0.02, 0.01, 0.04), vec3(0.28, 0.02, 0.06), exp(-abs(h) * 3.8));
          float flashSun = pow(sunDot, 10.0) * 0.75 + sunDisc * 0.9;
          silhouetteBg += vec3(1.0, 0.36, 0.24) * flashSun;
          sky = mix(sky, silhouetteBg, uFinisher);
        }

        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
}

export function createSlashTrailMaterial(colorHex: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uOpacity: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;

      void main() {
        // vUv.x = trail progress (0 = newest at blade, 1 = oldest tail)
        // vUv.y = across blade width (0 = hilt, 1 = tip)
        float tailFade = pow(1.0 - vUv.x, 1.8);
        float edgeSharp = smoothstep(0.0, 0.45, vUv.y) * (0.65 + 0.35 * vUv.y);
        float alpha = tailFade * edgeSharp * uOpacity;
        vec3 col = mix(uColor, vec3(1.0), pow(vUv.y, 2.5) * (1.0 - vUv.x) * 0.65);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}
