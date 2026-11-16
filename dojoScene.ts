import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FighterRuntime, SpectatorCameraMode } from '../types/game';
import { ProceduralFighterRig } from './fighterRig';
import { createTwilightSkyMaterial } from './shaders';

const PETAL_COUNT = 240;
const SPARK_COUNT = 180;
const SHOCKWAVE_COUNT = 20;
const SLASH_FX_COUNT = 22;
const AFTERIMAGE_COUNT = 18;

const _dummy = new THREE.Object3D();
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _camTargetPos = new THREE.Vector3();
const _camTargetLook = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();

interface PetalParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  vrx: number;
  vry: number;
  scale: number;
}

interface SparkParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  scale: number;
}

interface ShockwaveFx {
  active: boolean;
  x: number;
  y: number;
  z: number;
  age: number;
  life: number;
  maxScale: number;
  horizontal: boolean;
}

interface SlashArcFx {
  active: boolean;
  x: number;
  y: number;
  z: number;
  angle: number;
  age: number;
  life: number;
  maxScale: number;
}

interface AfterimageFx {
  active: boolean;
  x: number;
  y: number;
  tiltZ: number;
  age: number;
  life: number;
}

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

function createDojoWoodTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#18121c';
  ctx.fillRect(0, 0, 512, 512);

  // Wooden planks
  const plankCount = 8;
  const plankH = 512 / plankCount;
  for (let i = 0; i < plankCount; i++) {
    const y = i * plankH;
    const shade = 20 + (i % 3) * 5;
    ctx.fillStyle = `rgb(${shade + 8}, ${shade}, ${shade + 12})`;
    ctx.fillRect(0, y + 2, 512, plankH - 4);

    // Subtle wood grain
    ctx.strokeStyle = 'rgba(255, 190, 160, 0.06)';
    ctx.lineWidth = 1.5;
    for (let g = 0; g < 10; g++) {
      ctx.beginPath();
      const gy = y + 6 + (g / 10) * (plankH - 12);
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(170, gy + ((i + g) % 2 === 0 ? 3 : -3), 340, gy - 2, 512, gy);
      ctx.stroke();
    }

    // Horizontal plank seam + subtle warm grid highlight
    ctx.fillStyle = '#09060d';
    ctx.fillRect(0, y, 512, 3);
    ctx.fillStyle = 'rgba(255, 168, 108, 0.07)';
    ctx.fillRect(0, y + 3, 512, 1.5);

    // Vertical staggered floor grid seams
    const offset = (i % 2) * 128;
    for (let vx = offset; vx < 512; vx += 256) {
      ctx.fillStyle = '#09060d';
      ctx.fillRect(vx, y, 3, plankH);
      ctx.fillStyle = 'rgba(255, 168, 108, 0.06)';
      ctx.fillRect(vx + 3, y, 1.5, plankH);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 2);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createDojoCrestTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 512);

  ctx.strokeStyle = 'rgba(244, 148, 122, 0.28)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(256, 256, 210, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(256, 256, 178, 0, Math.PI * 2);
  ctx.stroke();

  // Inner kanji-inspired geometric diamond
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.18)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(256, 86);
  ctx.lineTo(426, 256);
  ctx.lineTo(256, 426);
  ctx.lineTo(86, 256);
  ctx.closePath();
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export class DojoArenaScene {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly controls: OrbitControls;
  public readonly isSoftwareGl: boolean;

  private container: HTMLElement;
  private skyMat: THREE.ShaderMaterial;
  private petalMesh: THREE.InstancedMesh;
  private petals: PetalParticle[] = [];
  private sparkMesh: THREE.InstancedMesh;
  private sparks: SparkParticle[] = [];
  private shockwaveMesh: THREE.InstancedMesh;
  private shockwaves: ShockwaveFx[] = [];
  private slashFxMesh: THREE.InstancedMesh;
  private slashFxs: SlashArcFx[] = [];
  private afterimageMesh: THREE.InstancedMesh;
  private afterimages: AfterimageFx[] = [];
  private afterimageCooldownA = 0;
  private afterimageCooldownB = 0;
  private eclipseLight: THREE.PointLight;
  private rimLightA: THREE.PointLight;
  private rimLightB: THREE.PointLight;
  private lanternLights: THREE.PointLight[] = [];
  private lanternGlowMats: THREE.MeshBasicMaterial[] = [];
  private hemiLight!: THREE.HemisphereLight;
  private fillLight!: THREE.DirectionalLight;
  private eclipseAmount = 0;
  private finisherAmount = 0;
  private banners: THREE.Mesh[] = [];
  private rigA: ProceduralFighterRig;
  private rigB: ProceduralFighterRig;

  private cameraLookAt = new THREE.Vector3(0, 1.35, 0);
  private shakeIntensity = 0;
  private spectatorMode = false;
  private spectatorCamMode: SpectatorCameraMode = 'follow';
  private freeFlyKeys = new Set<string>();
  private disposables: Array<{ dispose: () => void }> = [];

  constructor(container: HTMLElement) {
    this.container = container;
    this.isSoftwareGl = detectSoftwareWebGL();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);

    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x2a142d, 0.014);

    const aspect = (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 220);
    this.camera.position.set(0, 2.35, 10.8);

    // OrbitControls for Spectator Free Cam
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2.6;
    this.controls.maxDistance = 28;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.target.set(0, 1.35, 0);
    this.controls.enabled = false;

    // Studio Environment Reflection (RoomEnvironment)
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTex;
    this.disposables.push(envTex);
    pmremGenerator.dispose();

    // Sky Dome
    this.skyMat = createTwilightSkyMaterial();
    const skyGeo = new THREE.SphereGeometry(120, 32, 24);
    const skyMesh = new THREE.Mesh(skyGeo, this.skyMat);
    this.scene.add(skyMesh);
    this.disposables.push(skyGeo, this.skyMat);

    this.setupLighting();
    this.eclipseLight = new THREE.PointLight(0x22d3ee, 0, 14, 1.4);
    this.scene.add(this.eclipseLight);

    // Dynamic back-rim lights tracking fighters for crisp silhouette edge glow
    this.rimLightA = new THREE.PointLight(0x22d3ee, 3.6, 7.5, 1.6);
    this.rimLightB = new THREE.PointLight(0xfb3159, 3.6, 7.5, 1.6);
    this.scene.add(this.rimLightA, this.rimLightB);

    this.buildDojoEnvironment();

    // Blossoms, Sparks, Shockwaves, Slash Arcs & Shadow Afterimages
    const { mesh: pMesh, petals } = this.createBlossomSystem();
    this.petalMesh = pMesh;
    this.petals = petals;
    this.scene.add(this.petalMesh);

    const { mesh: sMesh, sparks } = this.createSparkPool();
    this.sparkMesh = sMesh;
    this.sparks = sparks;
    this.scene.add(this.sparkMesh);

    const { mesh: swMesh, shockwaves } = this.createShockwavePool();
    this.shockwaveMesh = swMesh;
    this.shockwaves = shockwaves;
    this.scene.add(this.shockwaveMesh);

    const { mesh: sfMesh, slashFxs } = this.createSlashFxPool();
    this.slashFxMesh = sfMesh;
    this.slashFxs = slashFxs;
    this.scene.add(this.slashFxMesh);

    const { mesh: aiMesh, afterimages } = this.createAfterimagePool();
    this.afterimageMesh = aiMesh;
    this.afterimages = afterimages;
    this.scene.add(this.afterimageMesh);

    // Fighter Rigs
    this.rigA = new ProceduralFighterRig('A', 'male', 'katana');
    this.rigB = new ProceduralFighterRig('B', 'female', 'daggers');
    this.scene.add(this.rigA.root, this.rigA.slashTrailMesh, this.rigA.slashTrailMeshL);
    this.scene.add(this.rigB.root, this.rigB.slashTrailMesh, this.rigB.slashTrailMeshL);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }
  }

  private track<T extends { dispose: () => void }>(res: T): T {
    this.disposables.push(res);
    return res;
  }

  private setupLighting(): void {
    // Cool twilight sky / warm lantern ground hemisphere fill
    this.hemiLight = new THREE.HemisphereLight(0x6e569c, 0x3b1f2b, 0.85);
    this.scene.add(this.hemiLight);

    // Warm sunset key directional light (single primary shadow caster)
    const key = new THREE.DirectionalLight(0xffb48a, 1.85);
    key.position.set(4, 11, -9);
    key.castShadow = !this.isSoftwareGl;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 35;
    key.shadow.camera.left = -13;
    key.shadow.camera.right = 13;
    key.shadow.camera.top = 10;
    key.shadow.camera.bottom = -4;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);

    // Front subtle cool fill light so wooden dojo planks & lanterns read clearly
    this.fillLight = new THREE.DirectionalLight(0x88b4ff, 0.55);
    this.fillLight.position.set(-4, 5, 10);
    this.scene.add(this.fillLight);

    // Warm flickering dojo lantern point lights flanking left, right & torii eaves
    const lanternPositions: Array<[number, number, number]> = [
      [-10.2, 2.2, -1.8],
      [10.2, 2.2, -1.8],
      [-5.6, 4.4, -3.5],
      [5.6, 4.4, -3.5],
    ];
    lanternPositions.forEach(([lx, ly, lz]) => {
      const l = new THREE.PointLight(0xff9442, 4.8, 15, 1.7);
      l.position.set(lx, ly, lz);
      this.scene.add(l);
      this.lanternLights.push(l);
    });
  }

  private buildDojoEnvironment(): void {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const woodTex = this.track(createDojoWoodTexture(maxAniso));
    const crestTex = this.track(createDojoCrestTexture(maxAniso));

    // Main Elevated Dojo Combat Deck
    const deckGeo = this.track(new THREE.BoxGeometry(24, 1.4, 8.2));
    const deckMat = this.track(
      new THREE.MeshStandardMaterial({
        map: woodTex,
        roughness: 0.72,
        metalness: 0.08,
      })
    );
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.set(0, -0.7, 0);
    deck.receiveShadow = true;
    this.scene.add(deck);

    // Subtle inlaid wooden dojo floor grid lines for spatial combat clarity
    const floorGrid = new THREE.GridHelper(24, 24, 0xff9f68, 0x5c3642);
    floorGrid.position.set(0, 0.006, 0);
    floorGrid.scale.set(1, 1, 8.2 / 24);
    const gridMat = floorGrid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.22;
    this.scene.add(floorGrid);

    // Center Dojo Crest Decal (polygonOffset to prevent Z-fighting)
    const crestGeo = this.track(new THREE.PlaneGeometry(5.2, 5.2));
    crestGeo.rotateX(-Math.PI / 2);
    const crestMat = this.track(
      new THREE.MeshBasicMaterial({
        map: crestTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    );
    const crest = new THREE.Mesh(crestGeo, crestMat);
    crest.position.set(0, 0.01, 0);
    this.scene.add(crest);

    // Dark stone foundation plinth extending outward (no floating rectangular box void)
    const groundGeo = this.track(new THREE.CircleGeometry(72, 48));
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0x0d0914,
        roughness: 0.92,
        metalness: 0.05,
      })
    );
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.y = -1.42;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Dojo Deck Edge Trim Beams & Posts
    const darkWoodMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x160e18, roughness: 0.85, metalness: 0.1 })
    );
    const lacquerMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x4a1622, roughness: 0.45, metalness: 0.2 })
    );

    const beamGeo = this.track(new THREE.BoxGeometry(24.4, 0.22, 0.28));
    const backBeam = new THREE.Mesh(beamGeo, lacquerMat);
    backBeam.position.set(0, 0.05, -3.95);
    this.scene.add(backBeam);

    // Background Torii / Pagoda Silhouette Framing (-10..+10 at Z = -4.2)
    const toriiGroup = new THREE.Group();
    const pillarGeo = this.track(new THREE.CylinderGeometry(0.22, 0.27, 6.4, 12));
    const pillarL = new THREE.Mesh(pillarGeo, lacquerMat);
    pillarL.position.set(-5.6, 3.2, -4.4);
    const pillarR = new THREE.Mesh(pillarGeo, lacquerMat);
    pillarR.position.set(5.6, 3.2, -4.4);
    toriiGroup.add(pillarL, pillarR);

    // Stone pillar bases
    const baseGeo = this.track(new THREE.CylinderGeometry(0.36, 0.42, 0.6, 10));
    const baseL = new THREE.Mesh(baseGeo, darkWoodMat);
    baseL.position.set(-5.6, 0.3, -4.4);
    const baseR = new THREE.Mesh(baseGeo, darkWoodMat);
    baseR.position.set(5.6, 0.3, -4.4);
    toriiGroup.add(baseL, baseR);

    // Curved Kasagi top beam + Nuki crossbeam
    const nukiGeo = this.track(new THREE.BoxGeometry(13.2, 0.26, 0.26));
    const nuki = new THREE.Mesh(nukiGeo, lacquerMat);
    nuki.position.set(0, 5.2, -4.4);
    toriiGroup.add(nuki);

    const kasagiShape = new THREE.Shape();
    kasagiShape.moveTo(-7.8, 0);
    kasagiShape.quadraticCurveTo(0, -0.38, 7.8, 0);
    kasagiShape.lineTo(7.4, 0.42);
    kasagiShape.quadraticCurveTo(0, 0.08, -7.4, 0.42);
    kasagiShape.closePath();
    const kasagiGeo = this.track(
      new THREE.ExtrudeGeometry(kasagiShape, { depth: 0.44, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04 })
    );
    kasagiGeo.translate(0, 0, -0.22);
    const kasagi = new THREE.Mesh(kasagiGeo, darkWoodMat);
    kasagi.position.set(0, 6.25, -4.4);
    toriiGroup.add(kasagi);

    // Swaying silk dojo banners
    const bannerGeo = this.track(new THREE.PlaneGeometry(0.75, 2.5, 1, 6));
    bannerGeo.translate(0, -1.25, 0);
    const bannerMatA = this.track(
      new THREE.MeshStandardMaterial({ color: 0x0b3a4a, roughness: 0.7, side: THREE.DoubleSide })
    );
    const bannerMatB = this.track(
      new THREE.MeshStandardMaterial({ color: 0x521226, roughness: 0.7, side: THREE.DoubleSide })
    );
    const bannerL = new THREE.Mesh(bannerGeo, bannerMatA);
    bannerL.position.set(-4.3, 5.1, -4.25);
    const bannerR = new THREE.Mesh(bannerGeo, bannerMatB);
    bannerR.position.set(4.3, 5.1, -4.25);
    toriiGroup.add(bannerL, bannerR);
    this.banners.push(bannerL, bannerR);

    this.scene.add(toriiGroup);

    // Multi-part Stone Lanterns (Toro) on arena flanks + Hanging Paper Chochin Lanterns
    this.buildStoneLantern(-10.2, -2.1);
    this.buildStoneLantern(10.2, -2.1);
    this.buildStoneLantern(-10.2, 2.6);
    this.buildStoneLantern(10.2, 2.6);
    this.buildHangingLantern(-5.6, 4.65, -3.7);
    this.buildHangingLantern(5.6, 4.65, -3.7);

    // Gnarled Sakura Silhouette Trees flanking the arena
    this.buildSakuraTree(-13.5, -6.5, 1.15);
    this.buildSakuraTree(13.8, -7.2, 1.25);

    // Layered Parallax Mountain Ridges
    this.buildMountainLayer(-26, 0x1e0e26, 9.5, 42);
    this.buildMountainLayer(-44, 0x150a1e, 15.0, 64);
    this.buildMountainLayer(-66, 0x0d0716, 21.0, 92);
  }

  private buildStoneLantern(x: number, z: number): void {
    const g = new THREE.Group();
    const stoneMat = this.track(new THREE.MeshStandardMaterial({ color: 0x1c1722, roughness: 0.9, metalness: 0.05 }));
    const glowMat = this.track(new THREE.MeshBasicMaterial({ color: 0xffaa58 }));
    this.lanternGlowMats.push(glowMat);

    const base = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.28, 0.36, 0.3, 6)), stoneMat);
    base.position.y = 0.15;
    const shaft = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.12, 0.15, 1.2, 6)), stoneMat);
    shaft.position.y = 0.9;
    const fireBox = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.32, 0.34, 0.32)), glowMat);
    fireBox.position.y = 1.65;
    const roof = new THREE.Mesh(this.track(new THREE.ConeGeometry(0.46, 0.34, 6)), stoneMat);
    roof.position.y = 1.98;
    const finial = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.08, 8, 6)), stoneMat);
    finial.position.y = 2.18;

    g.add(base, shaft, fireBox, roof, finial);
    g.position.set(x, 0, z);
    this.scene.add(g);
  }

  private buildHangingLantern(x: number, y: number, z: number): void {
    const g = new THREE.Group();
    const trimMat = this.track(new THREE.MeshStandardMaterial({ color: 0x140d18, roughness: 0.85 }));
    const paperMat = this.track(new THREE.MeshBasicMaterial({ color: 0xff9f52 }));
    this.lanternGlowMats.push(paperMat);

    const cord = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.015, 0.015, 0.65, 6)), trimMat);
    cord.position.y = 0.45;
    const capTop = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.16, 0.2, 0.08, 12)), trimMat);
    capTop.position.y = 0.16;
    const body = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.24, 0.24, 0.56, 12)), paperMat);
    body.position.y = -0.14;
    const capBot = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.18, 0.14, 0.08, 12)), trimMat);
    capBot.position.y = -0.44;

    g.add(cord, capTop, body, capBot);
    g.position.set(x, y, z);
    this.scene.add(g);
  }

  private buildSakuraTree(x: number, z: number, scale: number): void {
    const g = new THREE.Group();
    const barkMat = this.track(new THREE.MeshStandardMaterial({ color: 0x0b0810, roughness: 0.95 }));
    const blossomMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0x6b2040,
        emissive: 0x2c0a1b,
        roughness: 0.8,
      })
    );

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -1.4, 0),
      new THREE.Vector3(0.4, 1.2, 0.1),
      new THREE.Vector3(-0.3, 3.6, -0.2),
      new THREE.Vector3(1.1, 5.2, 0.3),
    ]);
    const trunkGeo = this.track(new THREE.TubeGeometry(curve, 14, 0.24, 8, false));
    g.add(new THREE.Mesh(trunkGeo, barkMat));

    const branchCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.1, 2.8, 0),
      new THREE.Vector3(-1.8, 4.2, 0.2),
      new THREE.Vector3(-3.0, 4.7, 0.1),
    ]);
    g.add(new THREE.Mesh(this.track(new THREE.TubeGeometry(branchCurve, 10, 0.12, 7, false)), barkMat));

    // Clustered silhouette canopy puffs
    const puffGeo = this.track(new THREE.IcosahedronGeometry(1.15, 1));
    const offsets = [
      [1.1, 5.4, 0.2, 1.2],
      [-0.4, 5.0, -0.3, 1.0],
      [-2.8, 4.8, 0.1, 1.15],
      [-1.5, 4.3, 0.3, 0.9],
      [2.2, 4.7, -0.2, 0.95],
    ];
    offsets.forEach(([ox, oy, oz, s]) => {
      const puff = new THREE.Mesh(puffGeo, blossomMat);
      puff.position.set(ox, oy, oz);
      puff.scale.set(s * 1.2, s * 0.72, s);
      g.add(puff);
    });

    g.position.set(x, 0, z);
    g.scale.setScalar(scale);
    this.scene.add(g);
  }

  private buildMountainLayer(z: number, colorHex: number, maxH: number, width: number): void {
    const shape = new THREE.Shape();
    shape.moveTo(-width, -6);
    const segments = 16;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = -width + t * width * 2;
      const ridge =
        Math.sin(t * Math.PI) * maxH * (0.45 + 0.55 * Math.abs(Math.sin(i * 1.73 + z * 0.13)));
      shape.lineTo(x, ridge - 1.5);
    }
    shape.lineTo(width, -6);
    shape.closePath();

    const geo = this.track(new THREE.ShapeGeometry(shape));
    const mat = this.track(new THREE.MeshBasicMaterial({ color: colorHex }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = z;
    this.scene.add(mesh);
  }

  private createBlossomSystem(): { mesh: THREE.InstancedMesh; petals: PetalParticle[] } {
    const geo = this.track(new THREE.PlaneGeometry(0.16, 0.105));
    const mat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      })
    );
    const mesh = new THREE.InstancedMesh(geo, mat, PETAL_COUNT);
    mesh.frustumCulled = false;

    const petals: PetalParticle[] = [];
    const color = new THREE.Color();
    for (let i = 0; i < PETAL_COUNT; i++) {
      const p: PetalParticle = {
        x: (Math.random() - 0.5) * 32,
        y: Math.random() * 12,
        z: -10 + Math.random() * 16,
        vx: -0.9 - Math.random() * 1.1,
        vy: -0.7 - Math.random() * 0.8,
        vz: (Math.random() - 0.5) * 0.4,
        rx: Math.random() * Math.PI,
        ry: Math.random() * Math.PI,
        rz: Math.random() * Math.PI,
        vrx: (Math.random() - 0.5) * 3,
        vry: (Math.random() - 0.5) * 3,
        scale: 0.75 + Math.random() * 0.7,
      };
      petals.push(p);
      color.setHSL(0.93 + Math.random() * 0.04, 0.78, 0.68 + Math.random() * 0.18);
      mesh.setColorAt(i, color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return { mesh, petals };
  }

  private createSparkPool(): { mesh: THREE.InstancedMesh; sparks: SparkParticle[] } {
    const geo = this.track(new THREE.OctahedronGeometry(0.08, 0));
    const mat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.95,
      })
    );
    const mesh = new THREE.InstancedMesh(geo, mat, SPARK_COUNT);
    mesh.frustumCulled = false;

    const sparks: SparkParticle[] = [];
    const color = new THREE.Color(0xffffff);
    for (let i = 0; i < SPARK_COUNT; i++) {
      sparks.push({
        active: false,
        x: 0,
        y: -50,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        life: 0.3,
        scale: 0,
      });
      mesh.setColorAt(i, color);
      _dummy.position.set(0, -50, 0);
      _dummy.scale.setScalar(0.001);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.instanceMatrix.needsUpdate = true;
    return { mesh, sparks };
  }

  private createShockwavePool(): { mesh: THREE.InstancedMesh; shockwaves: ShockwaveFx[] } {
    const geo = this.track(new THREE.RingGeometry(0.42, 0.56, 32));
    const mat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.88,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    const mesh = new THREE.InstancedMesh(geo, mat, SHOCKWAVE_COUNT);
    mesh.frustumCulled = false;

    const shockwaves: ShockwaveFx[] = [];
    const col = new THREE.Color(0xffffff);
    for (let i = 0; i < SHOCKWAVE_COUNT; i++) {
      shockwaves.push({
        active: false,
        x: 0,
        y: -50,
        z: 0,
        age: 0,
        life: 0.3,
        maxScale: 2,
        horizontal: false,
      });
      mesh.setColorAt(i, col);
      _dummy.position.set(0, -50, 0);
      _dummy.scale.setScalar(0.001);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.instanceMatrix.needsUpdate = true;
    return { mesh, shockwaves };
  }

  private createSlashFxPool(): { mesh: THREE.InstancedMesh; slashFxs: SlashArcFx[] } {
    // Tapered razor blade slash crescent diamond
    const shape = new THREE.Shape();
    shape.moveTo(-1.0, 0);
    shape.quadraticCurveTo(0, 0.16, 1.0, 0);
    shape.quadraticCurveTo(0, -0.05, -1.0, 0);
    const geo = this.track(new THREE.ShapeGeometry(shape));
    const mat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    const mesh = new THREE.InstancedMesh(geo, mat, SLASH_FX_COUNT);
    mesh.frustumCulled = false;

    const slashFxs: SlashArcFx[] = [];
    const col = new THREE.Color(0xffffff);
    for (let i = 0; i < SLASH_FX_COUNT; i++) {
      slashFxs.push({
        active: false,
        x: 0,
        y: -50,
        z: 0,
        angle: 0,
        age: 0,
        life: 0.2,
        maxScale: 1.5,
      });
      mesh.setColorAt(i, col);
      _dummy.position.set(0, -50, 0);
      _dummy.scale.setScalar(0.001);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.instanceMatrix.needsUpdate = true;
    return { mesh, slashFxs };
  }

  private createAfterimagePool(): { mesh: THREE.InstancedMesh; afterimages: AfterimageFx[] } {
    const geo = this.track(new THREE.CapsuleGeometry(0.19, 1.05, 4, 8));
    geo.translate(0, 0.88, 0);
    const mat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
      })
    );
    const mesh = new THREE.InstancedMesh(geo, mat, AFTERIMAGE_COUNT);
    mesh.frustumCulled = false;

    const afterimages: AfterimageFx[] = [];
    const col = new THREE.Color(0xffffff);
    for (let i = 0; i < AFTERIMAGE_COUNT; i++) {
      afterimages.push({ active: false, x: 0, y: -50, tiltZ: 0, age: 0, life: 0.24 });
      mesh.setColorAt(i, col);
      _dummy.position.set(0, -50, 0);
      _dummy.scale.setScalar(0.001);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.instanceMatrix.needsUpdate = true;
    return { mesh, afterimages };
  }

  public spawnShockwave(
    x: number,
    y: number,
    colorHex: number,
    maxScale = 2.4,
    life = 0.32,
    horizontal = false
  ): void {
    const col = new THREE.Color(colorHex);
    for (let i = 0; i < SHOCKWAVE_COUNT; i++) {
      const sw = this.shockwaves[i];
      if (!sw.active) {
        sw.active = true;
        sw.x = x;
        sw.y = y;
        sw.z = horizontal ? 0 : 0.28;
        sw.age = 0;
        sw.life = life;
        sw.maxScale = maxScale;
        sw.horizontal = horizontal;
        this.shockwaveMesh.setColorAt(i, col);
        if (this.shockwaveMesh.instanceColor) this.shockwaveMesh.instanceColor.needsUpdate = true;
        return;
      }
    }
  }

  public spawnSlashArc(
    x: number,
    y: number,
    colorHex: number,
    maxScale = 1.65,
    angle = (Math.random() - 0.5) * Math.PI,
    life = 0.2
  ): void {
    const col = new THREE.Color(colorHex);
    for (let i = 0; i < SLASH_FX_COUNT; i++) {
      const sf = this.slashFxs[i];
      if (!sf.active) {
        sf.active = true;
        sf.x = x;
        sf.y = y;
        sf.z = 0.35;
        sf.angle = angle;
        sf.age = 0;
        sf.life = life;
        sf.maxScale = maxScale;
        this.slashFxMesh.setColorAt(i, col);
        if (this.slashFxMesh.instanceColor) this.slashFxMesh.instanceColor.needsUpdate = true;
        return;
      }
    }
  }

  private spawnAfterimage(x: number, y: number, tiltZ: number, colorHex: number, life = 0.24): void {
    const col = new THREE.Color(colorHex);
    for (let i = 0; i < AFTERIMAGE_COUNT; i++) {
      const ai = this.afterimages[i];
      if (!ai.active) {
        ai.active = true;
        ai.x = x;
        ai.y = y;
        ai.tiltZ = tiltZ;
        ai.age = 0;
        ai.life = life;
        this.afterimageMesh.setColorAt(i, col);
        if (this.afterimageMesh.instanceColor) this.afterimageMesh.instanceColor.needsUpdate = true;
        return;
      }
    }
  }

  public spawnSparks(x: number, y: number, colorHex: number, count = 18, speedScale = 1.0): void {
    const col = new THREE.Color(colorHex);
    let spawned = 0;
    for (let i = 0; i < SPARK_COUNT && spawned < count; i++) {
      const s = this.sparks[i];
      if (!s.active) {
        s.active = true;
        s.x = x;
        s.y = y;
        s.z = (Math.random() - 0.5) * 0.45;
        const angle = Math.random() * Math.PI * 2;
        const spd = (3.4 + Math.random() * 6.8) * speedScale;
        s.vx = Math.cos(angle) * spd;
        s.vy = Math.sin(angle) * spd + 2.1;
        s.vz = (Math.random() - 0.5) * 4.0;
        s.age = 0;
        s.life = 0.22 + Math.random() * 0.28;
        s.scale = 0.65 + Math.random() * 1.15;
        this.sparkMesh.setColorAt(i, col);
        spawned++;
      }
    }
    if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true;
  }

  public triggerShake(amount: number): void {
    this.shakeIntensity = Math.max(this.shakeIntensity, amount);
  }

  public setSpectatorConfig(enabled: boolean, mode: SpectatorCameraMode): void {
    const wasFree = this.spectatorMode && this.spectatorCamMode === 'free';
    this.spectatorMode = enabled;
    this.spectatorCamMode = mode;
    const isFreeNow = enabled && mode === 'free';
    this.controls.enabled = isFreeNow;

    if (isFreeNow && !wasFree) {
      // Seed OrbitControls target near current lookAt so transition is seamless
      this.controls.target.copy(this.cameraLookAt);
      this.controls.update();
    }
  }

  public resetSpectatorCamera(): void {
    this.camera.position.set(0, 2.5, 11.2);
    this.cameraLookAt.set(0, 1.35, 0);
    this.controls.target.copy(this.cameraLookAt);
    this.controls.update();
  }

  public setFreeFlyKey(code: string, down: boolean): void {
    if (down) this.freeFlyKeys.add(code);
    else this.freeFlyKeys.delete(code);
  }

  public clearFreeFlyKeys(): void {
    this.freeFlyKeys.clear();
  }

  public projectToScreen(x: number, y: number, z = 0): { x: number; y: number } {
    _vec3A.set(x, y, z);
    _vec3A.project(this.camera);
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    return {
      x: ((_vec3A.x + 1) * 0.5) * w,
      y: ((-_vec3A.y + 1) * 0.5) * h,
    };
  }

  public resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    if (w <= 0 || h <= 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
  }

  public update(
    fighterA: FighterRuntime,
    fighterB: FighterRuntime,
    dt: number,
    elapsed: number,
    isTitleBackdrop: boolean,
    finisherActive = false
  ): void {
    this.skyMat.uniforms.uTime.value = elapsed;

    // Ensure rigs match current active fighter gender/weapon
    this.rigA.rebuildAppearance(fighterA.spec.gender, fighterA.spec.weapon);
    this.rigB.rebuildAppearance(fighterB.spec.gender, fighterB.spec.weapon);
    this.rigA.update(fighterA, dt, elapsed);
    this.rigB.update(fighterB, dt, elapsed);

    // Track glowing character rim lights behind each fighter
    this.rimLightA.position.set(fighterA.x - fighterA.facing * 0.4, fighterA.y + 1.45, -1.65);
    this.rimLightB.position.set(fighterB.x - fighterB.facing * 0.4, fighterB.y + 1.45, -1.65);

    // Shadow Eclipse & Slow-Motion Silhouette Finisher Atmosphere
    const ultFighter =
      fighterA.state === 'ultimate' ? fighterA : fighterB.state === 'ultimate' ? fighterB : null;
    this.eclipseAmount = THREE.MathUtils.damp(this.eclipseAmount, ultFighter ? 1.0 : 0.0, 8.5, dt);
    this.finisherAmount = THREE.MathUtils.damp(this.finisherAmount, finisherActive ? 1.0 : 0.0, 9.5, dt);
    this.skyMat.uniforms.uEclipse.value = this.eclipseAmount;
    this.skyMat.uniforms.uFinisher.value = this.finisherAmount;

    // High-contrast silhouette darkening during Finisher
    this.hemiLight.intensity = 0.85 * (1 - this.finisherAmount * 0.78);
    this.fillLight.intensity = 0.55 * (1 - this.finisherAmount * 0.88);

    // Warm flickering dojo lanterns
    this.lanternLights.forEach((light, idx) => {
      const flicker = 0.88 + 0.14 * Math.sin(elapsed * 7.5 + idx * 2.1) + 0.06 * Math.cos(elapsed * 13.3 + idx);
      light.intensity = 4.8 * flicker * (1 - this.finisherAmount * 0.65);
    });
    this.lanternGlowMats.forEach((mat, idx) => {
      const pulse = 0.85 + 0.15 * Math.sin(elapsed * 6.8 + idx * 1.9);
      mat.color.setRGB(1.0 * pulse, 0.64 * pulse, 0.32 * pulse);
    });

    if (ultFighter) {
      this.eclipseLight.color.setHex(ultFighter.spec.team === 'A' ? 0x22d3ee : 0xfb3159);
      this.eclipseLight.position.set(ultFighter.x, ultFighter.y + 1.4, 1.8);
      this.eclipseLight.intensity = 9.0 * this.eclipseAmount;
    } else {
      this.eclipseLight.intensity = 9.0 * this.eclipseAmount;
    }

    // Automatic Shadow Afterimages during Dash / Tag-In / Ultimate
    const handleAfterimages = (f: FighterRuntime, cd: number): number => {
      if (f.state === 'dash' || f.state === 'tagIn' || f.state === 'ultimate') {
        const nextCd = cd - dt;
        if (nextCd <= 0) {
          const hex = f.spec.team === 'A' ? 0x22d3ee : 0xfb3159;
          const tilt = f.state === 'dash' ? -f.facing * 0.42 : -f.facing * 0.2;
          this.spawnAfterimage(f.x, f.y, tilt, hex, f.state === 'ultimate' ? 0.28 : 0.2);
          return f.state === 'ultimate' ? 0.036 : 0.045;
        }
        return nextCd;
      }
      return 0;
    };
    this.afterimageCooldownA = handleAfterimages(fighterA, this.afterimageCooldownA);
    this.afterimageCooldownB = handleAfterimages(fighterB, this.afterimageCooldownB);

    // Sway dojo banners gently
    this.banners.forEach((b, i) => {
      b.rotation.x = 0.06 + Math.sin(elapsed * 2.2 + i) * 0.05;
      b.rotation.z = Math.cos(elapsed * 1.7 + i) * 0.035;
    });

    // Update falling sakura petals (zero GC)
    for (let i = 0; i < PETAL_COUNT; i++) {
      const p = this.petals[i];
      p.x += (p.vx + Math.sin(elapsed * 1.4 + i) * 0.35) * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rx += p.vrx * dt;
      p.ry += p.vry * dt;
      if (p.y < -1.4 || p.x < -18) {
        p.x = 14 + Math.random() * 6;
        p.y = 8 + Math.random() * 5;
        p.z = -10 + Math.random() * 16;
      }
      _dummy.position.set(p.x, p.y, p.z);
      _dummy.rotation.set(p.rx, p.ry, p.rz);
      _dummy.scale.setScalar(p.scale);
      _dummy.updateMatrix();
      this.petalMesh.setMatrixAt(i, _dummy.matrix);
    }
    this.petalMesh.instanceMatrix.needsUpdate = true;

    // Update velocity-streaked spark pool
    let sparksDirty = false;
    for (let i = 0; i < SPARK_COUNT; i++) {
      const s = this.sparks[i];
      if (!s.active) continue;
      sparksDirty = true;
      s.age += dt;
      if (s.age >= s.life) {
        s.active = false;
        _dummy.position.set(0, -50, 0);
        _dummy.scale.setScalar(0.001);
        _dummy.updateMatrix();
        this.sparkMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      s.vy -= 14.0 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      const lifeRatio = 1 - s.age / s.life;
      _dummy.position.set(s.x, s.y, s.z);
      // Orient diamond along velocity vector for razor-sharp spark streaks
      _vec3A.set(s.vx, s.vy, s.vz);
      if (_vec3A.lengthSq() > 0.001) {
        _vec3A.normalize();
        _quat.setFromUnitVectors(_up, _vec3A);
        _dummy.quaternion.copy(_quat);
      }
      _dummy.scale.set(s.scale * 0.42 * lifeRatio, s.scale * 2.1 * lifeRatio, s.scale * 0.42 * lifeRatio);
      _dummy.updateMatrix();
      this.sparkMesh.setMatrixAt(i, _dummy.matrix);
    }
    if (sparksDirty) {
      this.sparkMesh.instanceMatrix.needsUpdate = true;
    }

    // Reset dummy quaternion after spark orientation
    _dummy.quaternion.identity();

    // Update Shockwave Rings
    let swDirty = false;
    for (let i = 0; i < SHOCKWAVE_COUNT; i++) {
      const sw = this.shockwaves[i];
      if (!sw.active) continue;
      swDirty = true;
      sw.age += dt;
      if (sw.age >= sw.life) {
        sw.active = false;
        _dummy.position.set(0, -50, 0);
        _dummy.scale.setScalar(0.001);
        _dummy.updateMatrix();
        this.shockwaveMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      const prog = sw.age / sw.life;
      const easeOut = 1 - Math.pow(1 - prog, 2.4);
      const scale = 0.25 + easeOut * sw.maxScale;
      const thin = Math.max(0.05, 1 - prog);
      _dummy.position.set(sw.x, sw.y, sw.z);
      _dummy.rotation.set(sw.horizontal ? -Math.PI / 2 : 0, 0, 0);
      _dummy.scale.set(scale, scale, thin);
      _dummy.updateMatrix();
      this.shockwaveMesh.setMatrixAt(i, _dummy.matrix);
    }
    if (swDirty) this.shockwaveMesh.instanceMatrix.needsUpdate = true;

    // Update Directional Slash Flash Arcs
    let sfDirty = false;
    for (let i = 0; i < SLASH_FX_COUNT; i++) {
      const sf = this.slashFxs[i];
      if (!sf.active) continue;
      sfDirty = true;
      sf.age += dt;
      if (sf.age >= sf.life) {
        sf.active = false;
        _dummy.position.set(0, -50, 0);
        _dummy.scale.setScalar(0.001);
        _dummy.updateMatrix();
        this.slashFxMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      const prog = sf.age / sf.life;
      const lenScale = (0.5 + prog * 0.75) * sf.maxScale;
      const thickScale = (1 - prog) * sf.maxScale;
      _dummy.position.set(sf.x, sf.y, sf.z);
      _dummy.rotation.set(0, 0, sf.angle);
      _dummy.scale.set(lenScale, Math.max(0.04, thickScale), 1);
      _dummy.updateMatrix();
      this.slashFxMesh.setMatrixAt(i, _dummy.matrix);
    }
    if (sfDirty) this.slashFxMesh.instanceMatrix.needsUpdate = true;

    // Update Shadow Afterimage Ghosts
    let aiDirty = false;
    for (let i = 0; i < AFTERIMAGE_COUNT; i++) {
      const ai = this.afterimages[i];
      if (!ai.active) continue;
      aiDirty = true;
      ai.age += dt;
      if (ai.age >= ai.life) {
        ai.active = false;
        _dummy.position.set(0, -50, 0);
        _dummy.scale.setScalar(0.001);
        _dummy.updateMatrix();
        this.afterimageMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      const fade = 1 - ai.age / ai.life;
      _dummy.position.set(ai.x, ai.y, -0.08);
      _dummy.rotation.set(0, 0, ai.tiltZ);
      _dummy.scale.set(0.7 + fade * 0.35, 0.85 + fade * 0.25, 0.7 + fade * 0.35);
      _dummy.updateMatrix();
      this.afterimageMesh.setMatrixAt(i, _dummy.matrix);
    }
    if (aiDirty) this.afterimageMesh.instanceMatrix.needsUpdate = true;

    // Update camera
    this.updateCamera(fighterA, fighterB, dt, elapsed, isTitleBackdrop);

    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(
    fighterA: FighterRuntime,
    fighterB: FighterRuntime,
    dt: number,
    elapsed: number,
    isTitleBackdrop: boolean
  ): void {
    if (isTitleBackdrop) {
      // Gentle atmospheric camera pan for the Title Screen
      _camTargetPos.set(Math.sin(elapsed * 0.25) * 1.4, 2.15 + Math.cos(elapsed * 0.35) * 0.12, 9.6);
      _camTargetLook.set(0, 1.35, -0.5);
      this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _camTargetPos.x, 4, dt);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _camTargetPos.y, 4, dt);
      this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _camTargetPos.z, 4, dt);
      this.cameraLookAt.lerp(_camTargetLook, 1 - Math.exp(-4 * dt));
      this.camera.lookAt(this.cameraLookAt);
      return;
    }

    if (this.spectatorMode && this.spectatorCamMode === 'free') {
      // Manual WASD / QE free-fly + OrbitControls
      this.camera.getWorldDirection(_forward);
      _right.crossVectors(_forward, this.camera.up).normalize();
      const speed = (this.freeFlyKeys.has('ShiftLeft') || this.freeFlyKeys.has('ShiftRight') ? 14 : 7.5) * dt;

      _vec3B.set(0, 0, 0);
      if (this.freeFlyKeys.has('KeyW') || this.freeFlyKeys.has('ArrowUp')) _vec3B.addScaledVector(_forward, speed);
      if (this.freeFlyKeys.has('KeyS') || this.freeFlyKeys.has('ArrowDown')) _vec3B.addScaledVector(_forward, -speed);
      if (this.freeFlyKeys.has('KeyD') || this.freeFlyKeys.has('ArrowRight')) _vec3B.addScaledVector(_right, speed);
      if (this.freeFlyKeys.has('KeyA') || this.freeFlyKeys.has('ArrowLeft')) _vec3B.addScaledVector(_right, -speed);
      if (this.freeFlyKeys.has('KeyE') || this.freeFlyKeys.has('Space')) _vec3B.y += speed;
      if (this.freeFlyKeys.has('KeyQ') || this.freeFlyKeys.has('KeyC')) _vec3B.y -= speed;

      if (_vec3B.lengthSq() > 0) {
        this.camera.position.add(_vec3B);
        this.controls.target.add(_vec3B);
      }

      // Keep above floor
      if (this.camera.position.y < 0.4) this.camera.position.y = 0.4;
      this.controls.update();
      this.cameraLookAt.copy(this.controls.target);
      return;
    }

    // Damped tactical / spectator follow camera presets
    if (this.spectatorMode && this.spectatorCamMode === 'focusA') {
      _camTargetPos.set(fighterA.x - fighterA.facing * 2.8, fighterA.y + 1.9, 5.2);
      _camTargetLook.set(fighterA.x + fighterA.facing * 1.1, fighterA.y + 1.25, 0);
    } else if (this.spectatorMode && this.spectatorCamMode === 'focusB') {
      _camTargetPos.set(fighterB.x - fighterB.facing * 2.8, fighterB.y + 1.9, 5.2);
      _camTargetLook.set(fighterB.x + fighterB.facing * 1.1, fighterB.y + 1.25, 0);
    } else if (this.spectatorMode && this.spectatorCamMode === 'overhead') {
      const midX = (fighterA.x + fighterB.x) * 0.5;
      _camTargetPos.set(midX, 9.5, 11.5);
      _camTargetLook.set(midX, 0.8, 0);
    } else {
      // Standard 2.5D Action Framing ('follow') with dramatic Ultimate & Finisher Zoom-In
      const midX = (fighterA.x + fighterB.x) * 0.5;
      const midY = Math.max(fighterA.y, fighterB.y) * 0.35 + 1.28;
      const dist = Math.abs(fighterA.x - fighterB.x);
      const dramaticZoom = Math.max(this.eclipseAmount * 1.35, this.finisherAmount * 1.65);
      const targetZ = THREE.MathUtils.clamp(7.4 + dist * 0.62 - dramaticZoom, 5.6, 13.8);
      _camTargetPos.set(
        THREE.MathUtils.clamp(midX, -5.5, 5.5),
        2.1 + dist * 0.06 - Math.max(this.eclipseAmount, this.finisherAmount) * 0.24,
        targetZ
      );
      _camTargetLook.set(
        THREE.MathUtils.clamp(midX, -5.5, 5.5),
        midY + Math.max(this.eclipseAmount, this.finisherAmount) * 0.14,
        0
      );
    }

    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _camTargetPos.x, 7.5, dt);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _camTargetPos.y, 7.5, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _camTargetPos.z, 6.5, dt);
    this.cameraLookAt.lerp(_camTargetLook, 1 - Math.exp(-8 * dt));

    // Decaying camera shake
    if (this.shakeIntensity > 0.002) {
      const sx = (Math.random() - 0.5) * this.shakeIntensity;
      const sy = (Math.random() - 0.5) * this.shakeIntensity;
      this.camera.position.x += sx;
      this.camera.position.y += sy;
      this.shakeIntensity = THREE.MathUtils.damp(this.shakeIntensity, 0, 18, dt);
    } else {
      this.shakeIntensity = 0;
    }

    this.camera.lookAt(this.cameraLookAt);
  }

  public dispose(): void {
    this.controls.dispose();
    this.rigA.dispose();
    this.rigB.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
