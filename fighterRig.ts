import * as THREE from 'three';
import { FighterRuntime, Gender, TeamId, WeaponClass } from '../types/game';
import { createSilhouetteShaderMaterial, createSlashTrailMaterial } from './shaders';

const TRAIL_SEGMENTS = 18;
const _tipPos = new THREE.Vector3();
const _basePos = new THREE.Vector3();
const _tipPosL = new THREE.Vector3();
const _basePosL = new THREE.Vector3();

let sharedShadowTexture: THREE.CanvasTexture | null = null;
function getContactShadowTexture(): THREE.CanvasTexture {
  if (sharedShadowTexture) return sharedShadowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.78)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.35)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  sharedShadowTexture = new THREE.CanvasTexture(canvas);
  sharedShadowTexture.colorSpace = THREE.SRGBColorSpace;
  return sharedShadowTexture;
}

export interface FighterPoseTargets {
  pelvisY: number;
  pelvisRotX: number;
  pelvisRotY: number;
  pelvisRotZ: number;
  torsoRotX: number;
  torsoRotY: number;
  torsoRotZ: number;
  headRotX: number;
  headRotY: number;
  headRotZ: number;
  rShoulderX: number;
  rShoulderY: number;
  rShoulderZ: number;
  rElbowZ: number;
  rElbowX: number;
  lShoulderX: number;
  lShoulderY: number;
  lShoulderZ: number;
  lElbowZ: number;
  lElbowX: number;
  rHipX: number;
  rHipZ: number;
  rKneeZ: number;
  lHipX: number;
  lHipZ: number;
  lKneeZ: number;
  weaponRotZ: number;
  weaponRotX: number;
}

const DEFAULT_POSE: FighterPoseTargets = {
  pelvisY: 0.94,
  pelvisRotX: 0,
  pelvisRotY: 0,
  pelvisRotZ: 0,
  torsoRotX: 0,
  torsoRotY: 0.2,
  torsoRotZ: -0.05,
  headRotX: 0,
  headRotY: -0.15,
  headRotZ: 0.04,
  rShoulderX: 0.15,
  rShoulderY: 0,
  rShoulderZ: 0.55,
  rElbowZ: 1.05,
  rElbowX: 0,
  lShoulderX: -0.25,
  lShoulderY: 0.15,
  lShoulderZ: 0.85,
  lElbowZ: 1.25,
  lElbowX: 0,
  rHipX: 0,
  rHipZ: -0.24,
  rKneeZ: -0.22,
  lHipX: 0,
  lHipZ: 0.28,
  lKneeZ: -0.26,
  weaponRotZ: 0,
  weaponRotX: 0,
};

export class ProceduralFighterRig {
  public readonly root = new THREE.Group();
  public readonly bodyGroup = new THREE.Group();
  public readonly contactShadow: THREE.Mesh;
  public readonly silhouetteMaterial: THREE.ShaderMaterial;
  public readonly eyeMaterial: THREE.MeshBasicMaterial;
  public readonly weaponEdgeMaterial: THREE.MeshBasicMaterial;
  public readonly slashTrailMesh: THREE.Mesh;
  public readonly slashTrailMaterial: THREE.ShaderMaterial;
  public readonly slashTrailMeshL: THREE.Mesh;
  public readonly slashTrailMaterialL: THREE.ShaderMaterial;

  // Articulated joints
  private pelvis = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private ribbonA = new THREE.Group();
  private ribbonB = new THREE.Group();

  private rShoulder = new THREE.Group();
  private rElbow = new THREE.Group();
  private rHand = new THREE.Group();

  private lShoulder = new THREE.Group();
  private lElbow = new THREE.Group();
  private lHand = new THREE.Group();

  private rHip = new THREE.Group();
  private rKnee = new THREE.Group();

  private lHip = new THREE.Group();
  private lKnee = new THREE.Group();

  private weaponGroupR = new THREE.Group();
  private weaponGroupL = new THREE.Group();
  private weaponTipMarker = new THREE.Object3D();
  private weaponBaseMarker = new THREE.Object3D();
  private weaponTipMarkerL = new THREE.Object3D();
  private weaponBaseMarkerL = new THREE.Object3D();

  private auraRingA: THREE.Mesh;
  private auraRingB: THREE.Mesh;
  private auraMaterial: THREE.MeshBasicMaterial;

  private trailHistoryTip: THREE.Vector3[] = [];
  private trailHistoryBase: THREE.Vector3[] = [];
  private trailPositions: Float32Array;
  private trailActive = 0;

  private trailHistoryTipL: THREE.Vector3[] = [];
  private trailHistoryBaseL: THREE.Vector3[] = [];
  private trailPositionsL: Float32Array;
  private trailActiveL = 0;

  private gender: Gender;
  private weapon: WeaponClass;
  private team: TeamId;
  private readonly neonHex: number;
  private currentPose: FighterPoseTargets = { ...DEFAULT_POSE };
  private disposables: Array<{ dispose: () => void }> = [];

  constructor(team: TeamId, gender: Gender, weapon: WeaponClass) {
    this.team = team;
    this.gender = gender;
    this.weapon = weapon;

    const neonHex = team === 'A' ? 0x22d3ee : 0xfb3159;
    this.neonHex = neonHex;
    this.silhouetteMaterial = createSilhouetteShaderMaterial(neonHex);
    this.eyeMaterial = new THREE.MeshBasicMaterial({ color: neonHex });
    this.weaponEdgeMaterial = new THREE.MeshBasicMaterial({ color: neonHex });
    this.slashTrailMaterial = createSlashTrailMaterial(neonHex);
    this.slashTrailMaterialL = createSlashTrailMaterial(neonHex);
    this.auraMaterial = new THREE.MeshBasicMaterial({
      color: neonHex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.disposables.push(
      this.silhouetteMaterial,
      this.eyeMaterial,
      this.weaponEdgeMaterial,
      this.slashTrailMaterial,
      this.slashTrailMaterialL,
      this.auraMaterial
    );

    // Contact shadow grounded at y=0.012
    const shadowGeo = new THREE.PlaneGeometry(1.55, 0.85);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: getContactShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.75,
    });
    this.contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.contactShadow.position.y = 0.012;
    this.root.add(this.contactShadow);
    this.disposables.push(shadowGeo, shadowMat);

    this.root.add(this.bodyGroup);

    // Orbiting Shadow Halo Rings (Ultimate & Full Shadow Charge)
    const ringGeo = new THREE.TorusGeometry(0.92, 0.018, 8, 42);
    this.auraRingA = new THREE.Mesh(ringGeo, this.auraMaterial);
    this.auraRingA.position.y = 1.05;
    this.auraRingA.visible = false;
    this.auraRingB = new THREE.Mesh(ringGeo, this.auraMaterial);
    this.auraRingB.position.y = 1.05;
    this.auraRingB.visible = false;
    this.root.add(this.auraRingA, this.auraRingB);
    this.disposables.push(ringGeo);

    // Slash trail ribbon geometries (Right & Left/Opposite blade)
    const createTrailMesh = (
      mat: THREE.ShaderMaterial,
      histTip: THREE.Vector3[],
      histBase: THREE.Vector3[]
    ) => {
      const vertexCount = TRAIL_SEGMENTS * 2;
      const positions = new Float32Array(vertexCount * 3);
      const uvs = new Float32Array(vertexCount * 2);
      const indices: number[] = [];
      for (let i = 0; i < TRAIL_SEGMENTS; i++) {
        const u = i / (TRAIL_SEGMENTS - 1);
        uvs[i * 4 + 0] = u;
        uvs[i * 4 + 1] = 0;
        uvs[i * 4 + 2] = u;
        uvs[i * 4 + 3] = 1;
        if (i < TRAIL_SEGMENTS - 1) {
          const a = i * 2;
          const b = a + 1;
          const c = a + 2;
          const d = a + 3;
          indices.push(a, b, c, b, d, c);
        }
        histTip.push(new THREE.Vector3());
        histBase.push(new THREE.Vector3());
      }
      const trailGeo = new THREE.BufferGeometry();
      trailGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      trailGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      trailGeo.setIndex(indices);
      const mesh = new THREE.Mesh(trailGeo, mat);
      mesh.frustumCulled = false;
      this.disposables.push(trailGeo);
      return { mesh, positions };
    };

    const tR = createTrailMesh(this.slashTrailMaterial, this.trailHistoryTip, this.trailHistoryBase);
    this.slashTrailMesh = tR.mesh;
    this.trailPositions = tR.positions;

    const tL = createTrailMesh(this.slashTrailMaterialL, this.trailHistoryTipL, this.trailHistoryBaseL);
    this.slashTrailMeshL = tL.mesh;
    this.trailPositionsL = tL.positions;

    this.buildAnatomy();
    this.buildWeapons();
  }

  private track<T extends THREE.BufferGeometry>(geo: T): T {
    this.disposables.push(geo);
    return geo;
  }

  private buildAnatomy(): void {
    const isFemale = this.gender === 'female';
    const shoulderHalf = isFemale ? 0.175 : 0.235;
    const hipHalf = isFemale ? 0.125 : 0.11;
    const torsoHeight = isFemale ? 0.48 : 0.52;
    const limbScale = isFemale ? 0.88 : 1.04;

    // Pelvis
    this.pelvis.position.set(0, 0.94, 0);
    this.bodyGroup.add(this.pelvis);

    const pelvisGeo = this.track(new THREE.CylinderGeometry(isFemale ? 0.115 : 0.135, isFemale ? 0.15 : 0.125, 0.16, 12));
    const pelvisMesh = new THREE.Mesh(pelvisGeo, this.silhouetteMaterial);
    pelvisMesh.castShadow = true;
    this.pelvis.add(pelvisMesh);

    // Obi sash / martial skirt flare
    const sashGeo = this.track(new THREE.CylinderGeometry(isFemale ? 0.13 : 0.145, isFemale ? 0.22 : 0.17, isFemale ? 0.26 : 0.14, 14));
    const sashMesh = new THREE.Mesh(sashGeo, this.silhouetteMaterial);
    sashMesh.position.y = isFemale ? -0.05 : 0.02;
    sashMesh.castShadow = true;
    this.pelvis.add(sashMesh);

    // Torso
    this.torso.position.set(0, 0.08, 0);
    this.pelvis.add(this.torso);

    // Sculpted chest via LatheGeometry
    const torsoPoints = isFemale
      ? [
          new THREE.Vector2(0.0, 0.0),
          new THREE.Vector2(0.11, 0.02),
          new THREE.Vector2(0.10, 0.16),
          new THREE.Vector2(0.155, 0.34),
          new THREE.Vector2(0.14, 0.45),
          new THREE.Vector2(0.07, 0.50),
          new THREE.Vector2(0.0, 0.51),
        ]
      : [
          new THREE.Vector2(0.0, 0.0),
          new THREE.Vector2(0.13, 0.02),
          new THREE.Vector2(0.135, 0.16),
          new THREE.Vector2(0.20, 0.37),
          new THREE.Vector2(0.18, 0.49),
          new THREE.Vector2(0.085, 0.53),
          new THREE.Vector2(0.0, 0.54),
        ];
    const chestGeo = this.track(new THREE.LatheGeometry(torsoPoints, 14));
    chestGeo.scale(1.0, 1.0, 0.68);
    const chestMesh = new THREE.Mesh(chestGeo, this.silhouetteMaterial);
    chestMesh.castShadow = true;
    this.torso.add(chestMesh);

    // Shoulder armor pauldrons
    const pauldronGeo = this.track(new THREE.SphereGeometry(isFemale ? 0.075 : 0.098, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.65));
    const rPauldron = new THREE.Mesh(pauldronGeo, this.silhouetteMaterial);
    rPauldron.position.set(0, 0.02, shoulderHalf + 0.01);
    rPauldron.rotation.x = Math.PI * 0.12;
    this.torso.add(rPauldron);

    const lPauldron = new THREE.Mesh(pauldronGeo, this.silhouetteMaterial);
    lPauldron.position.set(0, 0.02, -(shoulderHalf + 0.01));
    lPauldron.rotation.x = -Math.PI * 0.12;
    this.torso.add(lPauldron);

    // Position pauldrons at shoulder height
    rPauldron.position.y = torsoHeight - 0.05;
    lPauldron.position.y = torsoHeight - 0.05;

    // Head
    this.head.position.set(0, torsoHeight + 0.05, 0);
    this.torso.add(this.head);

    const neckGeo = this.track(new THREE.CylinderGeometry(0.052, 0.064, 0.11, 10));
    const neckMesh = new THREE.Mesh(neckGeo, this.silhouetteMaterial);
    neckMesh.position.y = 0.02;
    this.head.add(neckMesh);

    const skullGeo = this.track(new THREE.SphereGeometry(isFemale ? 0.115 : 0.125, 14, 12));
    skullGeo.scale(1.05, 1.14, 0.92);
    const skullMesh = new THREE.Mesh(skullGeo, this.silhouetteMaterial);
    skullMesh.position.y = 0.15;
    skullMesh.castShadow = true;
    this.head.add(skullMesh);

    // Warrior helm crest / bun / brow
    if (isFemale) {
      const bunGeo = this.track(new THREE.SphereGeometry(0.068, 10, 8));
      const bunMesh = new THREE.Mesh(bunGeo, this.silhouetteMaterial);
      bunMesh.position.set(-0.10, 0.23, 0);
      this.head.add(bunMesh);
    } else {
      const crestGeo = this.track(new THREE.ConeGeometry(0.055, 0.14, 6));
      const crestMesh = new THREE.Mesh(crestGeo, this.silhouetteMaterial);
      crestMesh.position.set(-0.04, 0.28, 0);
      crestMesh.rotation.z = 0.45;
      this.head.add(crestMesh);
    }

    // Glowing neon eyes (angled sharp visor slits facing +X)
    const eyeGeo = this.track(new THREE.BoxGeometry(0.025, 0.018, 0.048));
    const eyeL = new THREE.Mesh(eyeGeo, this.eyeMaterial);
    eyeL.position.set(0.11, 0.165, -0.042);
    eyeL.rotation.z = 0.16;
    eyeL.rotation.y = 0.2;
    this.head.add(eyeL);

    const eyeR = new THREE.Mesh(eyeGeo, this.eyeMaterial);
    eyeR.position.set(0.11, 0.165, 0.042);
    eyeR.rotation.z = 0.16;
    eyeR.rotation.y = -0.2;
    this.head.add(eyeR);

    // Flowing headband ribbons
    const ribbonLenA = isFemale ? 0.44 : 0.34;
    const ribbonGeoA = this.track(new THREE.BoxGeometry(ribbonLenA, 0.036, 0.012));
    ribbonGeoA.translate(-ribbonLenA * 0.5, 0, 0);
    this.ribbonA.position.set(-0.11, 0.19, 0.02);
    this.ribbonA.add(new THREE.Mesh(ribbonGeoA, this.silhouetteMaterial));
    this.head.add(this.ribbonA);

    const ribbonLenB = isFemale ? 0.38 : 0.26;
    const ribbonGeoB = this.track(new THREE.BoxGeometry(ribbonLenB, 0.028, 0.012));
    ribbonGeoB.translate(-ribbonLenB * 0.5, 0, 0);
    this.ribbonB.position.set(-0.11, 0.17, -0.02);
    this.ribbonB.add(new THREE.Mesh(ribbonGeoB, this.silhouetteMaterial));
    this.head.add(this.ribbonB);

    // Arms (Right = +Z side, Left = -Z side)
    const upperArmLen = 0.29;
    const forearmLen = 0.27;
    const upperArmGeo = this.track(new THREE.CapsuleGeometry(0.05 * limbScale, upperArmLen - 0.08, 6, 10));
    upperArmGeo.translate(0, -upperArmLen * 0.5, 0);
    const forearmGeo = this.track(new THREE.CapsuleGeometry(0.042 * limbScale, forearmLen - 0.07, 6, 10));
    forearmGeo.translate(0, -forearmLen * 0.5, 0);
    const handGeo = this.track(new THREE.SphereGeometry(0.044 * limbScale, 8, 8));

    this.rShoulder.position.set(0, torsoHeight - 0.06, shoulderHalf);
    this.torso.add(this.rShoulder);
    const rUpperMesh = new THREE.Mesh(upperArmGeo, this.silhouetteMaterial);
    rUpperMesh.castShadow = true;
    this.rShoulder.add(rUpperMesh);

    this.rElbow.position.set(0, -upperArmLen, 0);
    this.rShoulder.add(this.rElbow);
    const rForeMesh = new THREE.Mesh(forearmGeo, this.silhouetteMaterial);
    rForeMesh.castShadow = true;
    this.rElbow.add(rForeMesh);

    this.rHand.position.set(0, -forearmLen, 0);
    this.rElbow.add(this.rHand);
    this.rHand.add(new THREE.Mesh(handGeo, this.silhouetteMaterial));
    this.rHand.add(this.weaponGroupR);

    this.lShoulder.position.set(0, torsoHeight - 0.06, -shoulderHalf);
    this.torso.add(this.lShoulder);
    const lUpperMesh = new THREE.Mesh(upperArmGeo, this.silhouetteMaterial);
    lUpperMesh.castShadow = true;
    this.lShoulder.add(lUpperMesh);

    this.lElbow.position.set(0, -upperArmLen, 0);
    this.lShoulder.add(this.lElbow);
    const lForeMesh = new THREE.Mesh(forearmGeo, this.silhouetteMaterial);
    lForeMesh.castShadow = true;
    this.lElbow.add(lForeMesh);

    this.lHand.position.set(0, -forearmLen, 0);
    this.lElbow.add(this.lHand);
    this.lHand.add(new THREE.Mesh(handGeo, this.silhouetteMaterial));
    this.lHand.add(this.weaponGroupL);

    // Legs
    const thighLen = 0.43;
    const calfLen = 0.43;
    const thighGeo = this.track(new THREE.CapsuleGeometry(0.072 * limbScale, thighLen - 0.11, 6, 10));
    thighGeo.translate(0, -thighLen * 0.5, 0);
    const calfGeo = this.track(new THREE.CapsuleGeometry(0.052 * limbScale, calfLen - 0.1, 6, 10));
    calfGeo.translate(0, -calfLen * 0.5, 0);
    const footGeo = this.track(new THREE.BoxGeometry(0.19, 0.065, 0.085));
    footGeo.translate(0.04, -0.03, 0);

    this.rHip.position.set(0, -0.04, hipHalf);
    this.pelvis.add(this.rHip);
    const rThighMesh = new THREE.Mesh(thighGeo, this.silhouetteMaterial);
    rThighMesh.castShadow = true;
    this.rHip.add(rThighMesh);

    this.rKnee.position.set(0, -thighLen, 0);
    this.rHip.add(this.rKnee);
    const rCalfMesh = new THREE.Mesh(calfGeo, this.silhouetteMaterial);
    rCalfMesh.castShadow = true;
    this.rKnee.add(rCalfMesh);
    const rFootMesh = new THREE.Mesh(footGeo, this.silhouetteMaterial);
    rFootMesh.position.set(0, -calfLen, 0);
    this.rKnee.add(rFootMesh);

    this.lHip.position.set(0, -0.04, -hipHalf);
    this.pelvis.add(this.lHip);
    const lThighMesh = new THREE.Mesh(thighGeo, this.silhouetteMaterial);
    lThighMesh.castShadow = true;
    this.lHip.add(lThighMesh);

    this.lKnee.position.set(0, -thighLen, 0);
    this.lHip.add(this.lKnee);
    const lCalfMesh = new THREE.Mesh(calfGeo, this.silhouetteMaterial);
    lCalfMesh.castShadow = true;
    this.lKnee.add(lCalfMesh);
    const lFootMesh = new THREE.Mesh(footGeo, this.silhouetteMaterial);
    lFootMesh.position.set(0, -calfLen, 0);
    this.lKnee.add(lFootMesh);
  }

  private createKatanaMesh(length = 1.05): THREE.Group {
    const g = new THREE.Group();
    const hiltGeo = this.track(new THREE.CylinderGeometry(0.018, 0.02, 0.24, 8));
    hiltGeo.rotateZ(Math.PI / 2);
    const hilt = new THREE.Mesh(hiltGeo, this.silhouetteMaterial);
    hilt.position.x = -0.08;
    g.add(hilt);

    const guardGeo = this.track(new THREE.CylinderGeometry(0.052, 0.052, 0.016, 12));
    guardGeo.rotateZ(Math.PI / 2);
    const guard = new THREE.Mesh(guardGeo, this.silhouetteMaterial);
    guard.position.x = 0.04;
    g.add(guard);

    // Slightly curved blade
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0.05, -0.014);
    bladeShape.quadraticCurveTo(length * 0.55, -0.005, length, 0.032);
    bladeShape.lineTo(length - 0.04, 0.044);
    bladeShape.quadraticCurveTo(length * 0.5, 0.02, 0.05, 0.014);
    bladeShape.closePath();

    const bladeGeo = this.track(
      new THREE.ExtrudeGeometry(bladeShape, { depth: 0.012, bevelEnabled: false, steps: 1 })
    );
    bladeGeo.translate(0, 0, -0.006);
    const blade = new THREE.Mesh(bladeGeo, this.silhouetteMaterial);
    g.add(blade);

    // Glowing neon blade edge
    const edgeGeo = this.track(new THREE.BoxGeometry(length - 0.07, 0.009, 0.016));
    const edge = new THREE.Mesh(edgeGeo, this.weaponEdgeMaterial);
    edge.position.set(length * 0.5 + 0.015, 0.018, 0);
    edge.rotation.z = 0.028;
    g.add(edge);

    return g;
  }

  private createDaggerMesh(): THREE.Group {
    const g = new THREE.Group();
    const hiltGeo = this.track(new THREE.CylinderGeometry(0.015, 0.016, 0.14, 8));
    hiltGeo.rotateZ(Math.PI / 2);
    g.add(new THREE.Mesh(hiltGeo, this.silhouetteMaterial));

    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0.06, -0.018);
    bladeShape.lineTo(0.42, 0.0);
    bladeShape.lineTo(0.06, 0.018);
    bladeShape.closePath();
    const bladeGeo = this.track(
      new THREE.ExtrudeGeometry(bladeShape, { depth: 0.012, bevelEnabled: false })
    );
    bladeGeo.translate(0, 0, -0.006);
    g.add(new THREE.Mesh(bladeGeo, this.silhouetteMaterial));

    const edgeGeo = this.track(new THREE.BoxGeometry(0.32, 0.008, 0.016));
    const edge = new THREE.Mesh(edgeGeo, this.weaponEdgeMaterial);
    edge.position.set(0.24, 0.004, 0);
    g.add(edge);
    return g;
  }

  private createStaffMesh(): THREE.Group {
    const g = new THREE.Group();
    const poleGeo = this.track(new THREE.CylinderGeometry(0.022, 0.022, 1.95, 10));
    poleGeo.rotateZ(Math.PI / 2);
    g.add(new THREE.Mesh(poleGeo, this.silhouetteMaterial));

    // Glowing neon end caps & center rings
    const capGeo = this.track(new THREE.CylinderGeometry(0.028, 0.028, 0.14, 10));
    capGeo.rotateZ(Math.PI / 2);
    const capA = new THREE.Mesh(capGeo, this.weaponEdgeMaterial);
    capA.position.x = 0.94;
    g.add(capA);

    const capB = new THREE.Mesh(capGeo, this.weaponEdgeMaterial);
    capB.position.x = -0.94;
    g.add(capB);

    const ringGeo = this.track(new THREE.TorusGeometry(0.028, 0.006, 6, 12));
    ringGeo.rotateY(Math.PI / 2);
    const ringA = new THREE.Mesh(ringGeo, this.weaponEdgeMaterial);
    ringA.position.x = 0.25;
    g.add(ringA);
    const ringB = new THREE.Mesh(ringGeo, this.weaponEdgeMaterial);
    ringB.position.x = -0.25;
    g.add(ringB);
    return g;
  }

  private buildWeapons(): void {
    if (this.weapon === 'katana') {
      const katana = this.createKatanaMesh(1.12);
      this.weaponGroupR.add(katana);
      this.weaponBaseMarker.position.set(0.08, 0, 0);
      this.weaponTipMarker.position.set(1.1, 0.02, 0);
      this.weaponGroupR.add(this.weaponBaseMarker, this.weaponTipMarker);
      // Secondary hand shadow trail marker for offhand/kick arcs
      this.weaponBaseMarkerL.position.set(0.0, 0, 0);
      this.weaponTipMarkerL.position.set(0.5, 0, 0);
      this.weaponGroupL.add(this.weaponBaseMarkerL, this.weaponTipMarkerL);
    } else if (this.weapon === 'daggers') {
      const d1 = this.createDaggerMesh();
      const d2 = this.createDaggerMesh();
      this.weaponGroupR.add(d1);
      this.weaponGroupL.add(d2);
      this.weaponBaseMarker.position.set(0.06, 0, 0);
      this.weaponTipMarker.position.set(0.46, 0, 0);
      this.weaponGroupR.add(this.weaponBaseMarker, this.weaponTipMarker);
      this.weaponBaseMarkerL.position.set(0.06, 0, 0);
      this.weaponTipMarkerL.position.set(0.46, 0, 0);
      this.weaponGroupL.add(this.weaponBaseMarkerL, this.weaponTipMarkerL);
    } else {
      const staff = this.createStaffMesh();
      this.weaponGroupR.add(staff);
      this.weaponBaseMarker.position.set(0.32, 0, 0);
      this.weaponTipMarker.position.set(1.02, 0, 0);
      this.weaponBaseMarkerL.position.set(-0.32, 0, 0);
      this.weaponTipMarkerL.position.set(-1.02, 0, 0);
      this.weaponGroupR.add(
        this.weaponBaseMarker,
        this.weaponTipMarker,
        this.weaponBaseMarkerL,
        this.weaponTipMarkerL
      );
    }
  }

  public rebuildAppearance(gender: Gender, weapon: WeaponClass): void {
    if (this.gender === gender && this.weapon === weapon) return;
    this.gender = gender;
    this.weapon = weapon;

    // Clear children of bodyGroup and rebuild
    this.bodyGroup.clear();
    this.pelvis = new THREE.Group();
    this.torso = new THREE.Group();
    this.head = new THREE.Group();
    this.ribbonA = new THREE.Group();
    this.ribbonB = new THREE.Group();
    this.rShoulder = new THREE.Group();
    this.rElbow = new THREE.Group();
    this.rHand = new THREE.Group();
    this.lShoulder = new THREE.Group();
    this.lElbow = new THREE.Group();
    this.lHand = new THREE.Group();
    this.rHip = new THREE.Group();
    this.rKnee = new THREE.Group();
    this.lHip = new THREE.Group();
    this.lKnee = new THREE.Group();
    this.weaponGroupR = new THREE.Group();
    this.weaponGroupL = new THREE.Group();

    this.buildAnatomy();
    this.buildWeapons();
  }

  public update(fighter: FighterRuntime, dt: number, elapsed: number): void {
    // Sync position & facing
    this.root.position.set(fighter.x, fighter.y, 0);
    const targetFacingY = fighter.facing === 1 ? 0 : Math.PI;
    this.bodyGroup.rotation.y = THREE.MathUtils.damp(this.bodyGroup.rotation.y, targetFacingY, 22, dt);

    // Contact shadow grounded at y=0 in world space regardless of fighter jump height
    this.contactShadow.position.y = -fighter.y + 0.015;
    const heightRatio = THREE.MathUtils.clamp(1.0 - fighter.y * 0.25, 0.35, 1.0);
    this.contactShadow.scale.setScalar(heightRatio);
    (this.contactShadow.material as THREE.MeshBasicMaterial).opacity = 0.72 * heightRatio;

    // Shader uniforms
    const uniforms = this.silhouetteMaterial.uniforms;
    uniforms.uTime.value = elapsed;
    uniforms.uHitFlash.value = fighter.hitFlash;
    uniforms.uShadowAura.value =
      fighter.state === 'ultimate'
        ? 1.85
        : fighter.superArmed
        ? 1.15
        : fighter.shadowEnergy >= 100
        ? 0.72 + 0.35 * Math.sin(elapsed * 8)
        : fighter.shadowEnergy * 0.0025;
    uniforms.uBlocking.value = fighter.state === 'block' ? 1.0 : 0.0;

    // Ultimate, Super Strike & Full-Shadow Halo Rings
    if (fighter.state === 'ultimate') {
      this.auraMaterial.color.setHex(this.neonHex);
      const p = fighter.stateDuration > 0 ? fighter.stateTime / fighter.stateDuration : 0;
      const ringScale = p < 0.25 ? 0.55 + p * 3.0 : 1.1 + 0.22 * Math.sin(elapsed * 22);
      this.auraRingA.visible = true;
      this.auraRingB.visible = true;
      this.auraRingA.position.y = this.currentPose.pelvisY + 0.22;
      this.auraRingB.position.y = this.currentPose.pelvisY + 0.22;
      this.auraRingA.scale.setScalar(ringScale);
      this.auraRingB.scale.setScalar(ringScale * 0.82);
      this.auraRingA.rotation.set(Math.PI * 0.38, elapsed * 6.5, elapsed * 4.2);
      this.auraRingB.rotation.set(-Math.PI * 0.32, -elapsed * 7.5, elapsed * 5.0);
      this.auraMaterial.opacity = 0.78;
    } else if (fighter.superArmed || (fighter.superCharge >= 100 && fighter.hp > 0)) {
      this.auraMaterial.color.setHex(0xfbbf24);
      this.auraRingA.visible = true;
      this.auraRingB.visible = false;
      this.auraRingA.position.y = fighter.superArmed ? this.currentPose.pelvisY + 0.16 : 0.1;
      this.auraRingA.scale.setScalar((fighter.superArmed ? 1.05 : 0.88) + 0.09 * Math.sin(elapsed * 9));
      this.auraRingA.rotation.set(Math.PI * 0.45, elapsed * 2.2, elapsed * 4.2);
      this.auraMaterial.opacity = fighter.superArmed ? 0.72 : 0.38 + 0.16 * Math.sin(elapsed * 7);
    } else if (fighter.shadowEnergy >= 100 && fighter.hp > 0) {
      this.auraMaterial.color.setHex(this.neonHex);
      this.auraRingA.visible = true;
      this.auraRingB.visible = false;
      this.auraRingA.position.y = 0.08;
      this.auraRingA.scale.setScalar(0.85 + 0.08 * Math.sin(elapsed * 6));
      this.auraRingA.rotation.set(Math.PI * 0.5, 0, elapsed * 2.4);
      this.auraMaterial.opacity = 0.32 + 0.14 * Math.sin(elapsed * 6);
    } else {
      this.auraMaterial.color.setHex(this.neonHex);
      this.auraRingA.visible = false;
      this.auraRingB.visible = false;
      this.auraMaterial.opacity = 0;
    }

    // Compute procedural target pose
    const target = this.computePose(fighter, elapsed);
    const dampSpeed =
      fighter.state === 'ultimate'
        ? 36
        : fighter.state === 'light1' ||
          fighter.state === 'light2' ||
          fighter.state === 'heavy' ||
          fighter.state === 'feint' ||
          fighter.state === 'hitstun'
        ? 29
        : 16;

    // Interpolate all pose channels smoothly
    const p = this.currentPose;
    (Object.keys(p) as Array<keyof FighterPoseTargets>).forEach((k) => {
      p[k] = THREE.MathUtils.damp(p[k], target[k], dampSpeed, dt);
    });

    this.pelvis.position.y = p.pelvisY;
    this.pelvis.rotation.set(p.pelvisRotX, p.pelvisRotY, p.pelvisRotZ);
    this.torso.rotation.set(p.torsoRotX, p.torsoRotY, p.torsoRotZ);
    this.head.rotation.set(p.headRotX, p.headRotY, p.headRotZ);

    this.rShoulder.rotation.set(p.rShoulderX, p.rShoulderY, p.rShoulderZ);
    this.rElbow.rotation.set(p.rElbowX, 0, p.rElbowZ);
    this.lShoulder.rotation.set(p.lShoulderX, p.lShoulderY, p.lShoulderZ);
    this.lElbow.rotation.set(p.lElbowX, 0, p.lElbowZ);

    this.rHip.rotation.set(p.rHipX, 0, p.rHipZ);
    this.rKnee.rotation.set(0, 0, p.rKneeZ);
    this.lHip.rotation.set(p.lHipX, 0, p.lHipZ);
    this.lKnee.rotation.set(0, 0, p.lKneeZ);

    this.weaponGroupR.rotation.set(p.weaponRotX, 0, p.weaponRotZ);
    this.weaponGroupL.rotation.set(p.weaponRotX * 0.85, 0, p.weaponRotZ * 0.85);

    // Flowing ribbons reacting to movement + breeze
    const windWave = Math.sin(elapsed * 5.2 + fighter.x) * 0.14;
    const speedTilt = THREE.MathUtils.clamp(-fighter.vx * fighter.facing * 0.08, -0.55, 0.55);
    this.ribbonA.rotation.z = -0.18 + windWave + speedTilt;
    this.ribbonA.rotation.y = Math.cos(elapsed * 3.8) * 0.15;
    this.ribbonB.rotation.z = -0.28 - windWave * 0.8 + speedTilt * 1.1;
    this.ribbonB.rotation.y = Math.sin(elapsed * 4.4) * 0.18;

    // Update weapon slash trails
    this.updateSlashTrail(fighter, dt);
  }

  private updateSingleTrail(
    active: boolean,
    targetAlpha: number,
    prevActive: number,
    tipMarker: THREE.Object3D,
    baseMarker: THREE.Object3D,
    tipPos: THREE.Vector3,
    basePos: THREE.Vector3,
    histTip: THREE.Vector3[],
    histBase: THREE.Vector3[],
    positions: Float32Array,
    mesh: THREE.Mesh,
    mat: THREE.ShaderMaterial,
    dt: number
  ): number {
    let nextActive = prevActive;
    if (active) {
      nextActive = THREE.MathUtils.damp(prevActive, targetAlpha, 28, dt);
      tipMarker.getWorldPosition(tipPos);
      baseMarker.getWorldPosition(basePos);

      for (let i = TRAIL_SEGMENTS - 1; i > 0; i--) {
        histTip[i].copy(histTip[i - 1]);
        histBase[i].copy(histBase[i - 1]);
      }
      histTip[0].copy(tipPos);
      histBase[0].copy(basePos);
    } else {
      nextActive = THREE.MathUtils.damp(prevActive, 0.0, 14, dt);
      if (nextActive < 0.02) {
        tipMarker.getWorldPosition(tipPos);
        baseMarker.getWorldPosition(basePos);
        for (let i = 0; i < TRAIL_SEGMENTS; i++) {
          histTip[i].copy(tipPos);
          histBase[i].copy(basePos);
        }
      }
    }

    for (let i = 0; i < TRAIL_SEGMENTS; i++) {
      const b = histBase[i];
      const t = histTip[i];
      const idx = i * 6;
      positions[idx + 0] = b.x;
      positions[idx + 1] = b.y;
      positions[idx + 2] = b.z;
      positions[idx + 3] = t.x;
      positions[idx + 4] = t.y;
      positions[idx + 5] = t.z;
    }

    const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    mat.uniforms.uOpacity.value = nextActive;
    mesh.visible = nextActive > 0.015;
    return nextActive;
  }

  private updateSlashTrail(fighter: FighterRuntime, dt: number): void {
    const isAttacking =
      fighter.state === 'light1' ||
      fighter.state === 'light2' ||
      fighter.state === 'heavy' ||
      fighter.state === 'ultimate' ||
      fighter.state === 'tagIn';

    const progress = fighter.stateDuration > 0 ? fighter.stateTime / fighter.stateDuration : 0;
    const trailWindow =
      fighter.state === 'ultimate'
        ? progress >= 0.18 && progress <= 0.96
        : isAttacking && progress >= 0.12 && progress <= 0.82;

    this.root.updateMatrixWorld(true);

    const alpha = fighter.state === 'ultimate' ? 1.0 : fighter.state === 'heavy' ? 0.98 : 0.88;
    this.trailActive = this.updateSingleTrail(
      trailWindow,
      alpha,
      this.trailActive,
      this.weaponTipMarker,
      this.weaponBaseMarker,
      _tipPos,
      _basePos,
      this.trailHistoryTip,
      this.trailHistoryBase,
      this.trailPositions,
      this.slashTrailMesh,
      this.slashTrailMaterial,
      dt
    );

    const useSecondaryTrail =
      trailWindow && (this.weapon === 'daggers' || this.weapon === 'staff' || fighter.state === 'ultimate');
    this.trailActiveL = this.updateSingleTrail(
      useSecondaryTrail,
      alpha * 0.9,
      this.trailActiveL,
      this.weaponTipMarkerL,
      this.weaponBaseMarkerL,
      _tipPosL,
      _basePosL,
      this.trailHistoryTipL,
      this.trailHistoryBaseL,
      this.trailPositionsL,
      this.slashTrailMeshL,
      this.slashTrailMaterialL,
      dt
    );
  }

  private computePose(fighter: FighterRuntime, elapsed: number): FighterPoseTargets {
    const isFemale = this.gender === 'female';
    const baseStanceY = isFemale ? 0.96 : 0.92;
    const pose: FighterPoseTargets = {
      ...DEFAULT_POSE,
      pelvisY: baseStanceY,
    };

    const t = fighter.stateTime;
    const d = Math.max(fighter.stateDuration, 0.01);
    const p = THREE.MathUtils.clamp(t / d, 0, 1);

    // Weapon-specific idle guard
    if (this.weapon === 'staff') {
      pose.rShoulderZ = 0.72;
      pose.rElbowZ = 0.85;
      pose.lShoulderZ = 0.95;
      pose.lElbowZ = 1.05;
      pose.weaponRotZ = -0.35;
    } else if (this.weapon === 'daggers') {
      pose.rShoulderZ = 0.85;
      pose.rElbowZ = 1.35;
      pose.lShoulderZ = 1.05;
      pose.lElbowZ = 1.45;
      pose.weaponRotZ = -0.2;
    } else {
      // Katana two-handed ready guard
      pose.rShoulderZ = 0.52;
      pose.rElbowZ = 1.1;
      pose.lShoulderZ = 0.72;
      pose.lElbowZ = 1.25;
      pose.weaponRotZ = 0.45;
    }

    switch (fighter.state) {
      case 'idle': {
        const breath = Math.sin(elapsed * 3.1 + (this.team === 'A' ? 0 : 1.7));
        pose.pelvisY = baseStanceY + breath * 0.022;
        pose.torsoRotZ = (isFemale ? -0.03 : -0.07) + breath * 0.025;
        pose.rShoulderZ += breath * 0.04;
        pose.lShoulderZ -= breath * 0.03;
        if (isFemale) {
          pose.rHipZ = -0.18;
          pose.lHipZ = 0.24;
        }
        break;
      }

      case 'walk': {
        const stride = Math.sin(elapsed * 11.5);
        const bounce = Math.abs(Math.cos(elapsed * 11.5)) * 0.04;
        pose.pelvisY = baseStanceY - 0.03 + bounce;
        pose.torsoRotZ = -0.14;
        pose.rHipZ = stride * 0.58;
        pose.rKneeZ = -Math.max(0, -stride) * 0.75 - 0.15;
        pose.lHipZ = -stride * 0.58;
        pose.lKneeZ = -Math.max(0, stride) * 0.75 - 0.15;
        pose.rShoulderZ += -stride * 0.2;
        pose.lShoulderZ += stride * 0.25;
        break;
      }

      case 'jump': {
        pose.pelvisY = baseStanceY + 0.05;
        pose.torsoRotZ = -0.18;
        pose.rHipZ = 0.65;
        pose.rKneeZ = -1.15;
        pose.lHipZ = -0.25;
        pose.lKneeZ = -0.65;
        pose.rShoulderZ += 0.35;
        pose.lShoulderZ += 0.45;
        break;
      }

      case 'crouch': {
        pose.pelvisY = baseStanceY - 0.34;
        pose.torsoRotZ = -0.28;
        pose.rHipZ = 0.78;
        pose.rKneeZ = -1.45;
        pose.lHipZ = 0.52;
        pose.lKneeZ = -1.2;
        pose.rShoulderZ += 0.25;
        break;
      }

      case 'dash': {
        pose.pelvisY = baseStanceY - 0.12;
        pose.torsoRotZ = -0.48;
        pose.rHipZ = -0.52;
        pose.rKneeZ = -0.45;
        pose.lHipZ = 0.62;
        pose.lKneeZ = -0.8;
        pose.rShoulderZ = -0.45;
        pose.rElbowZ = 0.35;
        pose.lShoulderZ = -0.35;
        break;
      }

      case 'block': {
        pose.pelvisY = baseStanceY - 0.08;
        pose.torsoRotZ = 0.08;
        pose.torsoRotY = 0.45;
        pose.rShoulderZ = 1.25;
        pose.rElbowZ = 1.45;
        pose.lShoulderZ = 1.35;
        pose.lElbowZ = 1.5;
        pose.weaponRotZ = 1.2;
        pose.rHipZ = -0.35;
        pose.lHipZ = 0.35;
        break;
      }

      case 'light1': {
        if (!fighter.grounded) {
          // Aerial plunging slash
          const s = Math.sin(p * Math.PI);
          pose.pelvisRotZ = -0.45 * s;
          pose.torsoRotZ = -0.35;
          pose.rShoulderZ = THREE.MathUtils.lerp(2.4, 0.25, p);
          pose.rElbowZ = 0.2;
          pose.lShoulderZ = 1.1;
          pose.rHipZ = 0.75;
          pose.rKneeZ = -1.2;
          pose.lHipZ = -0.3;
          pose.weaponRotZ = -0.55;
          break;
        }
        const swing = Math.sin(p * Math.PI);
        pose.pelvisY = baseStanceY - 0.06;
        pose.torsoRotY = THREE.MathUtils.lerp(-0.55, 0.85, p);
        pose.torsoRotZ = -0.25 * swing;
        if (this.weapon === 'daggers') {
          // Crisp twin assassin X-jab
          pose.rShoulderZ = 1.65 * swing + 0.3;
          pose.rElbowZ = 0.18;
          pose.lShoulderZ = 1.2 * swing + 0.4;
          pose.lElbowZ = 0.35;
          pose.weaponRotZ = -0.35;
        } else if (this.weapon === 'staff') {
          // Sweeping bo-staff thrust & whip
          pose.rShoulderZ = 1.42 * swing + 0.45;
          pose.rElbowZ = 0.15;
          pose.lShoulderZ = 1.15 * swing;
          pose.weaponRotZ = -0.85 * swing;
        } else {
          // Iaido chest-level kesa-giri cut
          pose.rShoulderZ = THREE.MathUtils.lerp(2.25, 0.32, p);
          pose.rShoulderX = THREE.MathUtils.lerp(-0.65, 0.78, p);
          pose.rElbowZ = 0.18;
          pose.weaponRotZ = -0.48;
        }
        pose.rHipZ = -0.45;
        pose.lHipZ = 0.48;
        break;
      }

      case 'light2': {
        // Rising acrobatic spin kick + reverse weapon uppercut
        const swing = Math.sin(p * Math.PI);
        pose.pelvisY = baseStanceY + 0.09 * swing;
        pose.torsoRotY = THREE.MathUtils.lerp(0.75, -0.85, p);
        pose.torsoRotZ = 0.24 * swing;
        if (this.weapon === 'daggers') {
          pose.lShoulderZ = 1.75 * swing + 0.35;
          pose.lElbowZ = 0.14;
          pose.rShoulderZ = 0.35;
        } else if (this.weapon === 'staff') {
          pose.pelvisRotY = p * Math.PI * 2;
          pose.rShoulderZ = 1.45;
          pose.rElbowZ = 0.2;
          pose.weaponRotZ = -0.6;
        } else {
          pose.rShoulderZ = THREE.MathUtils.lerp(0.25, 2.35, p);
          pose.rElbowZ = 0.16;
          pose.weaponRotZ = 0.65;
        }
        pose.lHipZ = 1.38 * swing;
        pose.lKneeZ = -0.22 * (1 - swing);
        pose.rHipZ = -0.32;
        break;
      }

      case 'heavy': {
        if (!fighter.grounded) {
          // Airborne Helm-Breaker Somersault Cleave
          pose.pelvisRotZ = -p * Math.PI * 2;
          pose.torsoRotZ = -0.3;
          pose.rShoulderZ = 2.35;
          pose.lShoulderZ = 2.15;
          pose.rElbowZ = 0.15;
          pose.weaponRotZ = -0.4;
          pose.rHipZ = 0.7;
          pose.rKneeZ = -1.2;
          break;
        }
        // Visible anticipation windup (0..0.36) -> leaping cleave (0.36..0.72) -> deep follow-through
        if (p < 0.36) {
          const w = p / 0.36;
          pose.pelvisY = baseStanceY - 0.12 * w;
          pose.torsoRotZ = 0.32 * w;
          pose.torsoRotY = -0.95 * w;
          pose.rShoulderZ = THREE.MathUtils.lerp(0.6, 2.75, w);
          pose.rElbowZ = 0.4;
          pose.lShoulderZ = 2.1 * w;
          pose.weaponRotZ = 0.9 * w;
        } else {
          const s = THREE.MathUtils.clamp((p - 0.36) / 0.34, 0, 1);
          pose.pelvisY = baseStanceY + 0.14 * Math.sin(s * Math.PI) - 0.16 * s;
          pose.torsoRotZ = THREE.MathUtils.lerp(0.32, -0.52, s);
          pose.torsoRotY = THREE.MathUtils.lerp(-0.95, 1.1, s);
          pose.rShoulderZ = THREE.MathUtils.lerp(2.75, -0.25, s);
          pose.rElbowZ = 0.1;
          pose.lShoulderZ = THREE.MathUtils.lerp(2.1, 0.2, s);
          pose.weaponRotZ = THREE.MathUtils.lerp(0.9, -0.78, s);
          pose.rHipZ = -0.62;
          pose.lHipZ = 0.68;
          pose.lKneeZ = -0.45 * s;
        }
        break;
      }

      case 'feint': {
        // Quick forward pump-fake lunge + weapon raise, then snap-back guard
        if (p < 0.55) {
          const f = p / 0.55;
          pose.pelvisY = baseStanceY - 0.1 * f;
          pose.torsoRotZ = -0.34 * f;
          pose.torsoRotY = -0.45 * f;
          pose.rShoulderZ = THREE.MathUtils.lerp(0.6, 2.15, f);
          pose.rElbowZ = 0.42;
          pose.lShoulderZ = THREE.MathUtils.lerp(0.8, 1.55, f);
          pose.weaponRotZ = 0.72 * f;
          pose.rHipZ = -0.5;
          pose.lHipZ = 0.55;
        } else {
          const b = (p - 0.55) / 0.45;
          pose.pelvisY = THREE.MathUtils.lerp(baseStanceY - 0.1, baseStanceY, b);
          pose.torsoRotZ = THREE.MathUtils.lerp(-0.34, 0.08, b);
          pose.torsoRotY = THREE.MathUtils.lerp(-0.45, 0.25, b);
          pose.rShoulderZ = THREE.MathUtils.lerp(2.15, 0.72, b);
          pose.rElbowZ = THREE.MathUtils.lerp(0.42, 1.15, b);
          pose.lShoulderZ = THREE.MathUtils.lerp(1.55, 0.95, b);
          pose.weaponRotZ = THREE.MathUtils.lerp(0.72, 0.35, b);
          pose.rHipZ = -0.25;
          pose.lHipZ = 0.28;
        }
        break;
      }

      case 'ultimate': {
        // SHADOW ECLIPSE: 4-Stage Choreographed Cinematic Sequence
        if (p < 0.23) {
          // Stage 1: Shadow Ascension (levitate, arms/blades spread in eclipse cross)
          const u = Math.sin((p / 0.23) * Math.PI * 0.5);
          pose.pelvisY = baseStanceY + 0.68 * u;
          pose.torsoRotZ = 0.26 * u;
          pose.headRotZ = 0.28 * u;
          pose.rShoulderZ = 2.45 * u;
          pose.rShoulderX = -0.55 * u;
          pose.lShoulderZ = 2.45 * u;
          pose.lShoulderX = 0.55 * u;
          pose.rElbowZ = 0.2;
          pose.lElbowZ = 0.2;
          pose.rHipZ = 0.35 * u;
          pose.rKneeZ = -0.65 * u;
          pose.lHipZ = -0.25 * u;
          pose.lKneeZ = -0.45 * u;
          pose.weaponRotZ = 0.6 * u;
        } else if (p < 0.68) {
          // Stage 2: High-Speed Phantom Blitz & Multi-Cross Flurry
          const flurry = (p - 0.23) / 0.45;
          const whip = Math.sin(flurry * Math.PI * 6);
          const whipCos = Math.cos(flurry * Math.PI * 6);
          pose.pelvisY = baseStanceY + 0.25 + 0.14 * Math.sin(flurry * Math.PI * 3);
          pose.pelvisRotY = flurry * Math.PI * 4;
          pose.torsoRotZ = -0.46;
          pose.torsoRotY = whip * 0.9;
          pose.rShoulderZ = 1.55 + whip * 0.85;
          pose.rShoulderX = whipCos * 0.9;
          pose.rElbowZ = 0.15;
          pose.lShoulderZ = 1.55 - whip * 0.85;
          pose.lShoulderX = -whipCos * 0.9;
          pose.lElbowZ = 0.15;
          pose.weaponRotZ = -0.55 + whip * 0.35;
          pose.rHipZ = 0.62;
          pose.rKneeZ = -1.05;
          pose.lHipZ = -0.38;
          pose.lKneeZ = -0.5;
        } else if (p < 0.82) {
          // Stage 3: High Airborne Apex Vault & Execution Windup
          const v = (p - 0.68) / 0.14;
          pose.pelvisY = baseStanceY + 0.35 + Math.sin(v * Math.PI * 0.5) * 0.72;
          pose.pelvisRotZ = -0.28 * v;
          pose.torsoRotZ = 0.38 * v;
          pose.rShoulderZ = 2.8;
          pose.lShoulderZ = 2.6;
          pose.rElbowZ = 0.28;
          pose.lElbowZ = 0.28;
          pose.weaponRotZ = 0.85;
          pose.rHipZ = 0.75;
          pose.rKneeZ = -1.25;
        } else {
          // Stage 4: Meteoric Judgment Slam Finisher!
          const slam = THREE.MathUtils.clamp((p - 0.82) / 0.1, 0, 1);
          pose.pelvisY = THREE.MathUtils.lerp(baseStanceY + 0.85, baseStanceY - 0.24, slam);
          pose.torsoRotZ = THREE.MathUtils.lerp(0.35, -0.62, slam);
          pose.torsoRotY = THREE.MathUtils.lerp(-0.6, 0.85, slam);
          pose.rShoulderZ = THREE.MathUtils.lerp(2.8, -0.35, slam);
          pose.lShoulderZ = THREE.MathUtils.lerp(2.6, 0.3, slam);
          pose.rElbowZ = 0.08;
          pose.weaponRotZ = THREE.MathUtils.lerp(0.85, -0.95, slam);
          pose.rHipZ = -0.65;
          pose.lHipZ = 0.85;
          pose.lKneeZ = -0.95 * slam;
        }
        break;
      }

      case 'tagIn': {
        // Diving aerial entrance strike
        const dive = Math.sin(p * Math.PI);
        pose.pelvisY = baseStanceY - 0.12 * (1 - dive);
        pose.torsoRotZ = -0.42;
        pose.rShoulderZ = THREE.MathUtils.lerp(2.5, 0.2, p);
        pose.rElbowZ = 0.15;
        pose.lHipZ = 0.95 * dive;
        pose.rHipZ = -0.55;
        pose.weaponRotZ = -0.55;
        break;
      }

      case 'tagOut': {
        pose.pelvisY = baseStanceY + 0.15;
        pose.torsoRotZ = 0.3;
        pose.rHipZ = 0.8;
        pose.rKneeZ = -1.2;
        pose.lHipZ = 0.5;
        pose.lKneeZ = -1.1;
        break;
      }

      case 'hitstun': {
        const recoil = Math.sin(p * Math.PI);
        pose.pelvisY = baseStanceY - 0.08 * recoil;
        pose.torsoRotZ = 0.48 * recoil;
        pose.headRotZ = 0.42 * recoil;
        pose.rShoulderZ = -0.45 * recoil;
        pose.lShoulderZ = -0.35 * recoil;
        pose.rHipZ = -0.34;
        pose.lHipZ = 0.18;
        break;
      }

      case 'ko': {
        // Dramatic launch, mid-collapse spin & deck bounce
        const fall = Math.min(p * 1.45, 1);
        const bounce = p > 0.68 ? Math.sin(((p - 0.68) / 0.32) * Math.PI) * 0.12 : 0;
        pose.pelvisY = THREE.MathUtils.lerp(baseStanceY + 0.15, 0.17, fall) + bounce;
        pose.pelvisRotZ = THREE.MathUtils.lerp(0.15, Math.PI * 0.49, fall);
        pose.pelvisRotY = Math.min(p * 1.1, 0.35);
        pose.torsoRotZ = 0.22;
        pose.headRotZ = 0.3;
        pose.rShoulderZ = -0.55;
        pose.lShoulderZ = 0.65;
        pose.rKneeZ = -0.3;
        pose.lKneeZ = -0.18;
        break;
      }

      case 'victory': {
        const salute = Math.min(p * 2.0, 1);
        pose.pelvisY = baseStanceY + 0.025 * Math.sin(elapsed * 2.6);
        if (this.weapon === 'katana') {
          // Chiburi blood-flick outward arc -> dignified low-held katana
          const flick = p < 0.45 ? Math.sin((p / 0.45) * Math.PI) : 0;
          pose.torsoRotZ = 0.05;
          pose.torsoRotY = 0.25 * salute;
          pose.rShoulderZ = 0.45 + flick * 1.4;
          pose.rShoulderX = flick * 0.8;
          pose.rElbowZ = 0.25;
          pose.lShoulderZ = 0.4;
          pose.weaponRotZ = -0.35 - flick * 0.4;
        } else if (this.weapon === 'daggers') {
          // Twin dagger spin flourish & assassin cross-bow
          pose.torsoRotZ = -0.18 * salute;
          pose.rShoulderZ = 1.35 * salute;
          pose.lShoulderZ = 1.35 * salute;
          pose.rElbowZ = 1.4;
          pose.lElbowZ = 1.4;
          pose.weaponRotZ = 0.6;
        } else {
          // Bo staff heroic floor plant
          pose.torsoRotZ = 0.06;
          pose.rShoulderZ = 1.25 * salute;
          pose.rElbowZ = 0.45;
          pose.lShoulderZ = 0.35;
          pose.weaponRotZ = 0.45;
        }
        break;
      }
    }

    return pose;
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
