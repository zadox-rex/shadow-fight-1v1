export type Gender = 'male' | 'female';
export type WeaponClass = 'daggers' | 'katana' | 'staff';
export type GameMode = '1v1' | '3v3';
export type TeamId = 'A' | 'B';
export type MatchRole = 'player' | 'spectator';
export type SpectatorCameraMode = 'follow' | 'free' | 'focusA' | 'focusB' | 'overhead';

export type FighterStateName =
  | 'idle'
  | 'walk'
  | 'jump'
  | 'crouch'
  | 'dash'
  | 'block'
  | 'light1'
  | 'light2'
  | 'heavy'
  | 'feint'
  | 'ultimate'
  | 'hitstun'
  | 'tagIn'
  | 'tagOut'
  | 'ko'
  | 'victory';

export interface FighterSpec {
  id: string;
  name: string;
  gender: Gender;
  weapon: WeaponClass;
  team: TeamId;
  isAI: boolean;
  ownerSocketId?: string;
}

export interface FighterRuntime {
  spec: FighterSpec;
  hp: number;
  maxHp: number;
  displayHp: number;
  shadowEnergy: number; // 0..100
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  state: FighterStateName;
  stateTime: number;
  stateDuration: number;
  hitApplied: boolean;
  ultStage: number;
  feintUsed: boolean;
  superCharge: number; // 0..100
  superArmed: boolean;
  comboQueued: boolean;
  comboCount: number;
  hitFlash: number;
  blockStartTime: number;
  invulnTimer: number;
  tagCooldown: number;
  eliminated: boolean;
}

export interface FloatingDamage {
  id: number;
  x: number;
  y: number;
  z: number;
  screenX: number;
  screenY: number;
  text: string;
  color: string;
  age: number;
  duration: number;
  isCrit: boolean;
}

export interface TeamHUDState {
  activeIndex: number;
  roundsWon: number;
  fighters: Array<{
    id: string;
    name: string;
    gender: Gender;
    weapon: WeaponClass;
    hp: number;
    maxHp: number;
    displayHp: number;
    shadowEnergy: number;
    superCharge: number;
    superArmed: boolean;
    feintUsed: boolean;
    tagCooldown: number;
    eliminated: boolean;
    isAI: boolean;
  }>;
}

export interface MatchHUDState {
  phase: 'lobby' | 'intro' | 'fighting' | 'roundEnd' | 'matchEnd';
  mode: GameMode;
  roundNumber: number;
  roundTimer: number;
  announcement: string;
  announcementSub: string;
  teamA: TeamHUDState;
  teamB: TeamHUDState;
  winner: TeamId | 'DRAW' | null;
  finisherActive?: boolean;
  stats: {
    damageA: number;
    damageB: number;
    maxComboA: number;
    maxComboB: number;
    parriesA: number;
    parriesB: number;
    kosA: number;
    kosB: number;
  };
}

export interface LobbyPlayer {
  socketId: string;
  name: string;
  gender: Gender;
  weapon: WeaponClass;
  team: TeamId | 'SPECTATOR';
  ready: boolean;
  slotIndex: number;
}

export interface RoomSnapshot {
  roomId: string;
  mode: GameMode;
  hostSocketId: string;
  status: 'waiting' | 'playing';
  players: LobbyPlayer[];
  spectatorCount: number;
}

export interface SyncFighterPayload {
  roomId: string;
  team: TeamId;
  activeIndex: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  state: FighterStateName;
  stateTime: number;
  hp: number;
  shadowEnergy: number;
  superCharge?: number;
  superArmed?: boolean;
  tagCooldown: number;
}

export interface SyncHitPayload {
  roomId: string;
  attackerTeam: TeamId;
  defenderTeam: TeamId;
  damage: number;
  isCrit: boolean;
  isBlocked: boolean;
  isParry: boolean;
  isHeavy: boolean;
  isUltimate: boolean;
  defenderHp: number;
  defenderEliminated: boolean;
  knockbackX: number;
  knockbackY: number;
  hitX: number;
  hitY: number;
}

export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  block: boolean;
  lightPressed: boolean;
  heavyPressed: boolean;
  dashPressed: boolean;
  feintPressed: boolean;
  superPressed: boolean;
  tagPressed: boolean;
  ultimatePressed: boolean;
  jumpPressed: boolean;
}
