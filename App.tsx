import { useCallback, useEffect, useRef, useState } from 'react';
import { soundEngine } from './audio/soundEngine';
import { CombatEngine } from './combat/combatEngine';
import { FightHUD } from './components/FightHUD';
import { MatchEndModal } from './components/MatchEndModal';
import { TitleLobbyScreen } from './components/TitleLobbyScreen';
import { MatchStartPayload, useMultiplayer } from './net/useMultiplayer';
import { DojoArenaScene } from './three/dojoScene';
import {
  FighterSpec,
  FloatingDamage,
  GameMode,
  Gender,
  InputState,
  MatchHUDState,
  MatchRole,
  SpectatorCameraMode,
  TeamId,
  WeaponClass,
} from './types/game';

const INITIAL_HUD: MatchHUDState = {
  phase: 'lobby',
  mode: '1v1',
  roundNumber: 1,
  roundTimer: 90,
  announcement: '',
  announcementSub: '',
  teamA: { activeIndex: 0, roundsWon: 0, fighters: [] },
  teamB: { activeIndex: 0, roundsWon: 0, fighters: [] },
  winner: null,
  stats: {
    damageA: 0,
    damageB: 0,
    maxComboA: 0,
    maxComboB: 0,
    parriesA: 0,
    parriesB: 0,
    kosA: 0,
    kosB: 0,
  },
};

function buildSoloRosters(
  mode: GameMode,
  playerSpec: { name: string; gender: Gender; weapon: WeaponClass },
  spectatorExhibition: boolean
): { rosterA: FighterSpec[]; rosterB: FighterSpec[] } {
  const count = mode === '3v3' ? 3 : 1;
  const allies: Array<{ name: string; gender: Gender; weapon: WeaponClass }> = [
    { name: 'Raiden', gender: 'male', weapon: 'staff' },
    { name: 'Yuki', gender: 'female', weapon: 'daggers' },
  ];
  const enemies: Array<{ name: string; gender: Gender; weapon: WeaponClass }> = [
    { name: 'Akane', gender: 'female', weapon: 'daggers' },
    { name: 'Kenshin', gender: 'male', weapon: 'katana' },
    { name: 'Hana', gender: 'female', weapon: 'staff' },
  ];

  const rosterA: FighterSpec[] = [];
  const rosterB: FighterSpec[] = [];

  for (let i = 0; i < count; i++) {
    if (i === 0) {
      rosterA.push({
        id: `A-${i}`,
        name: spectatorExhibition ? 'Kuro (AI)' : playerSpec.name || 'Kuro',
        gender: playerSpec.gender,
        weapon: playerSpec.weapon,
        team: 'A',
        isAI: spectatorExhibition,
      });
    } else {
      const a = allies[(i - 1) % allies.length];
      rosterA.push({
        id: `A-${i}`,
        name: a.name,
        gender: a.gender,
        weapon: a.weapon,
        team: 'A',
        isAI: spectatorExhibition,
      });
    }

    const e = enemies[i % enemies.length];
    rosterB.push({
      id: `B-${i}`,
      name: e.name,
      gender: e.gender,
      weapon: e.weapon,
      team: 'B',
      isAI: true,
    });
  }

  return { rosterA, rosterB };
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const dojoRef = useRef<DojoArenaScene | null>(null);
  const engineRef = useRef<CombatEngine | null>(null);

  const [nickname, setNickname] = useState('Kuro');
  const [gender, setGender] = useState<Gender>('male');
  const [weapon, setWeapon] = useState<WeaponClass>('katana');
  const [mode, setMode] = useState<GameMode>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === '3v3' ? '3v3' : '1v1';
  });
  const [roomCodeInput, setRoomCodeInput] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('room') || '').toUpperCase();
  });

  const [hud, setHud] = useState<MatchHUDState>(INITIAL_HUD);
  const [damages, setDamages] = useState<FloatingDamage[]>([]);
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);

  const [isSoloSpectator, setIsSoloSpectator] = useState(false);
  const [spectatorCamMode, setSpectatorCamMode] = useState<SpectatorCameraMode>('follow');
  const [soloLocalTeam, setSoloLocalTeam] = useState<TeamId | null>('A');

  const damagesRef = useRef<FloatingDamage[]>([]);
  const nextDamageIdRef = useRef(1);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  // Input buffers (held vs edge-triggered)
  const heldKeysRef = useRef<Set<string>>(new Set());
  const touchHeldRef = useRef({
    left: false,
    right: false,
    up: false,
    down: false,
    block: false,
  });
  const edgeQueueRef = useRef({
    lightPressed: false,
    heavyPressed: false,
    dashPressed: false,
    feintPressed: false,
    superPressed: false,
    tagPressed: false,
    ultimatePressed: false,
    jumpPressed: false,
  });

  const swipeOriginRef = useRef<{ x: number; y: number } | null>(null);
  const swipeTimerRef = useRef<number | null>(null);

  const multiplayerRef = useRef<ReturnType<typeof useMultiplayer> | null>(null);
  const roomRef = useRef<string | null>(null);
  const isSpectatorRef = useRef(false);
  const localTeamRef = useRef<TeamId | null>('A');

  const spawnFloatingDamage = useCallback((x: number, y: number, text: string, color: string, isCrit: boolean) => {
    const dojo = dojoRef.current;
    const screen = dojo ? dojo.projectToScreen(x, y, 0) : { x: window.innerWidth * 0.5, y: window.innerHeight * 0.45 };
    damagesRef.current.push({
      id: nextDamageIdRef.current++,
      x,
      y,
      z: 0,
      screenX: screen.x,
      screenY: screen.y,
      text,
      color,
      age: 0,
      duration: isCrit ? 0.95 : 0.72,
      isCrit,
    });
  }, []);

  const handleMatchStartFromNetwork = useCallback((payload: MatchStartPayload) => {
    soundEngine.unlock();
    soundEngine.playGong();
    setPaused(false);
    setIsSoloSpectator(false);
    const mp = multiplayerRef.current;
    const role = mp?.myRole || 'player';
    const team = mp?.myTeam || null;
    const controlTeam = role === 'spectator' ? null : team;

    engineRef.current?.startMatch({
      mode: payload.mode,
      rosterA: payload.rosterA,
      rosterB: payload.rosterB,
      localControlTeam: controlTeam,
      isOnline: true,
    });

    if (payload.latestStates?.A) {
      engineRef.current?.applyRemoteFighterState(payload.latestStates.A);
    }
    if (payload.latestStates?.B) {
      engineRef.current?.applyRemoteFighterState(payload.latestStates.B);
    }

    if (engineRef.current) {
      setHud(engineRef.current.getHUDState());
    }
  }, []);

  const mp = useMultiplayer({
    onMatchStart: handleMatchStartFromNetwork,
    onRemoteState: (payload) => {
      const myTeamNow = multiplayerRef.current?.myTeam;
      const myRoleNow = multiplayerRef.current?.myRole;
      if (myRoleNow === 'player' && myTeamNow === payload.team) return;
      engineRef.current?.applyRemoteFighterState(payload);
    },
    onRemoteHit: (payload) => {
      const myTeamNow = multiplayerRef.current?.myTeam;
      const myRoleNow = multiplayerRef.current?.myRole;
      if (myRoleNow === 'player' && myTeamNow === payload.attackerTeam) return;
      engineRef.current?.applyRemoteHit(payload);
    },
  });

  multiplayerRef.current = mp;
  roomRef.current = mp.room?.roomId || null;

  const isSpectator = mp.room ? mp.myRole === 'spectator' : isSoloSpectator;
  const activeLocalTeam = mp.room ? (mp.myRole === 'spectator' ? null : mp.myTeam) : isSoloSpectator ? null : soloLocalTeam;
  isSpectatorRef.current = isSpectator;
  localTeamRef.current = activeLocalTeam;

  // Sync URL with room state
  useEffect(() => {
    if (mp.room) {
      const url = new URL(window.location.href);
      url.searchParams.set('room', mp.room.roomId);
      url.searchParams.set('mode', mp.room.mode);
      if (mp.myRole === 'spectator') url.searchParams.set('spectate', '1');
      else url.searchParams.delete('spectate');
      window.history.replaceState({}, '', url.toString());
    }
  }, [mp.room, mp.myRole]);

  // Auto-join room from URL parameter on initial connect
  const autoJoinedRef = useRef(false);
  useEffect(() => {
    if (!mp.connected || autoJoinedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get('room');
    if (urlRoom) {
      autoJoinedRef.current = true;
      const urlMode: GameMode = params.get('mode') === '3v3' ? '3v3' : '1v1';
      const spectateParam = params.get('spectate');
      const asSpectator = spectateParam === '1' || spectateParam === 'true' || params.get('role') === 'spectator';
      mp.joinRoom(urlRoom, { name: nickname, gender, weapon }, urlMode, asSpectator);
    }
  }, [mp.connected, mp, nickname, gender, weapon]);

  // Sync Spectator Camera Mode to DojoArenaScene
  useEffect(() => {
    dojoRef.current?.setSpectatorConfig(isSpectator && hud.phase !== 'lobby', spectatorCamMode);
  }, [isSpectator, hud.phase, spectatorCamMode]);

  // Update Lobby 3D Preview Silhouette immediately on Gender/Weapon/Name change
  useEffect(() => {
    engineRef.current?.updateLobbyPreviewAppearance(gender, weapon, nickname);
  }, [gender, weapon, nickname]);

  // Unlock dojo music on first user gesture & clean up on unmount
  useEffect(() => {
    const handleFirstGesture = () => {
      soundEngine.unlock();
      window.removeEventListener('pointerdown', handleFirstGesture);
      window.removeEventListener('keydown', handleFirstGesture);
    };
    window.addEventListener('pointerdown', handleFirstGesture);
    window.addEventListener('keydown', handleFirstGesture);
    return () => {
      window.removeEventListener('pointerdown', handleFirstGesture);
      window.removeEventListener('keydown', handleFirstGesture);
      soundEngine.stopMusic();
    };
  }, []);

  // Switch dojo music intensity between ambient lobby, battle, and low-HP/final-round climax
  useEffect(() => {
    const isBattle = hud.phase === 'intro' || hud.phase === 'fighting' || hud.phase === 'roundEnd';
    soundEngine.setMusicMode(isBattle ? 'combat' : 'lobby');

    if (!isBattle) {
      soundEngine.setCombatClimax(false);
      return;
    }

    const activeA = hud.teamA.fighters[hud.teamA.activeIndex];
    const activeB = hud.teamB.fighters[hud.teamB.activeIndex];
    const lowHp =
      (activeA && activeA.maxHp > 0 && activeA.hp / activeA.maxHp < 0.4) ||
      (activeB && activeB.maxHp > 0 && activeB.hp / activeB.maxHp < 0.4);
    const decidingRound =
      hud.roundNumber >= 3 || (hud.teamA.roundsWon >= 1 && hud.teamB.roundsWon >= 1);
    soundEngine.setCombatClimax(Boolean(lowHp || decidingRound));
  }, [hud.phase, hud.roundNumber, hud.teamA, hud.teamB]);

  // Update server profile when changed inside waiting room
  useEffect(() => {
    if (mp.room && mp.room.status === 'waiting' && mp.myRole === 'player') {
      mp.updateProfile({ name: nickname, gender, weapon, ready: true });
    }
  }, [nickname, gender, weapon, mp.room?.roomId, mp.room?.status, mp.myRole]);

  // Initialize Three.js Scene + Combat Engine + 60fps Game Loop ONCE
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const dojo = new DojoArenaScene(mount);
    dojoRef.current = dojo;

    const engine = new CombatEngine({
      onSwing: (w, heavy) => {
        soundEngine.playSwing(w, heavy);
      },
      onDash: (team, x, y) => {
        soundEngine.playDash();
        const hex = team === 'A' ? 0x22d3ee : 0xfb3159;
        dojo.spawnShockwave(x, y + 0.12, hex, 1.85, 0.24, true);
        dojo.spawnSparks(x, y + 0.2, hex, 10, 0.75);
      },
      onFeint: (team, x, y) => {
        soundEngine.playFeint();
        const hex = team === 'A' ? 0xa855f7 : 0xf472b6;
        dojo.spawnShockwave(x, y + 0.9, hex, 1.9, 0.22, false);
        dojo.spawnSparks(x, y + 1.0, hex, 14, 0.9);
        spawnFloatingDamage(x, y + 1.9, 'FEINT!', '#e879f9', true);
      },
      onDodgeCharge: (team, x, y, evadedAttack) => {
        if (evadedAttack) {
          const hex = team === 'A' ? 0x22d3ee : 0xfb3159;
          dojo.spawnSparks(x, y + 1.0, 0xfde047, 16, 1.05);
          dojo.spawnShockwave(x, y + 0.9, hex, 2.2, 0.26, false);
          spawnFloatingDamage(x, y + 1.95, 'EVADED!', '#67e8f9', true);
        }
      },
      onSuperStrike: (_team, x, y) => {
        soundEngine.playSuperStrike();
        dojo.spawnSparks(x, y + 1.1, 0xfbbf24, 28, 1.35);
        dojo.spawnShockwave(x, y + 1.0, 0xfbbf24, 3.0, 0.34, false);
        spawnFloatingDamage(x, y + 2.05, 'SUPER 2X!', '#fde047', true);
      },
      onTagIn: (team, name) => {
        soundEngine.playTagIn();
        const f = team === 'A' ? engine.getActiveA() : engine.getActiveB();
        const hex = team === 'A' ? 0x22d3ee : 0xfb3159;
        dojo.spawnSparks(f.x, f.y + 1.0, hex, 26, 1.25);
        dojo.spawnShockwave(f.x, 0.08, hex, 3.0, 0.36, true);
        spawnFloatingDamage(f.x, f.y + 2.0, `TAG: ${name}`, team === 'A' ? '#67e8f9' : '#fda4af', true);
      },
      onUltimate: (team) => {
        soundEngine.playUltimate();
        const f = team === 'A' ? engine.getActiveA() : engine.getActiveB();
        const hex = team === 'A' ? 0x22d3ee : 0xfb3159;
        dojo.spawnSparks(f.x, f.y + 1.1, hex, 42, 1.65);
        dojo.spawnShockwave(f.x, f.y + 1.0, hex, 4.4, 0.45, false);
        dojo.spawnShockwave(f.x, 0.08, hex, 3.8, 0.4, true);
      },
      onAnnouncement: (text) => {
        if (text === 'FIGHT!' || text === 'K.O.!' || text === 'K.O.') {
          soundEngine.playGong();
        }
      },
      onHitstop: (dur) => {
        engine.triggerHitstop(dur);
      },
      onShake: (amt) => {
        dojo.triggerShake(amt);
      },
      onHit: (ev) => {
        if (ev.isParry) {
          soundEngine.playBlock(true);
          dojo.spawnSparks(ev.x, ev.y, 0xfbbf24, 30, 1.45);
          dojo.spawnShockwave(ev.x, ev.y, 0xfbbf24, 3.1, 0.34, false);
          dojo.spawnSlashArc(ev.x, ev.y, 0xfde047, 1.9, Math.PI * 0.25, 0.22);
          dojo.spawnSlashArc(ev.x, ev.y, 0xfde047, 1.9, -Math.PI * 0.25, 0.22);
          spawnFloatingDamage(ev.x, ev.y + 0.3, 'PARRY!', '#fde047', true);
        } else if (ev.isBlocked) {
          soundEngine.playBlock(false);
          dojo.spawnSparks(ev.x, ev.y, 0x94a3b8, 12, 0.8);
          dojo.spawnShockwave(ev.x, ev.y, 0x94a3b8, 1.5, 0.2, false);
          spawnFloatingDamage(ev.x, ev.y + 0.2, `BLOCK -${ev.damage}`, '#cbd5e1', false);
        } else {
          soundEngine.playHit(ev.isHeavy || ev.isUltimate || Boolean(ev.isSuper), ev.weapon, ev.isCrit, ev.isUltimate);
          if (ev.isFinisher) {
            soundEngine.playFinisherKO();
          }
          const colorHex = ev.isSuper ? 0xfbbf24 : ev.attackerTeam === 'A' ? 0x22d3ee : 0xfb3159;
          const sparkCount = ev.isFinisher ? 58 : ev.isUltimate || ev.isSuper ? 40 : ev.isHeavy ? 28 : 16;
          const speedScale = ev.isFinisher ? 1.85 : ev.isUltimate || ev.isSuper ? 1.55 : ev.isHeavy ? 1.35 : 0.95;
          dojo.spawnSparks(ev.x, ev.y, colorHex, sparkCount, speedScale);

          // Crisp slash arc flash(es)
          const baseAngle = (Math.random() - 0.5) * 1.8;
          dojo.spawnSlashArc(
            ev.x,
            ev.y,
            ev.isCrit || ev.isSuper ? 0xfde047 : colorHex,
            ev.isUltimate || ev.isFinisher ? 2.8 : ev.isHeavy || ev.isSuper ? 2.1 : 1.35,
            baseAngle,
            ev.isHeavy || ev.isUltimate || ev.isSuper ? 0.24 : 0.16
          );
          if (ev.isCrit || ev.isUltimate || ev.isFinisher || ev.isSuper) {
            dojo.spawnSlashArc(ev.x, ev.y, 0xffffff, 2.3, baseAngle + Math.PI * 0.52, 0.22);
          }

          // Expanding impact shockwaves
          if (ev.isFinisher) {
            dojo.spawnShockwave(ev.x, ev.y, 0xfde047, 5.8, 0.58, false);
            dojo.spawnShockwave(ev.x, ev.y, 0xfb3159, 4.4, 0.45, false);
            dojo.spawnShockwave(ev.x, 0.08, colorHex, 4.8, 0.48, true);
          } else if (ev.isUltimate || ev.isHeavy || ev.isCrit || ev.isSuper) {
            dojo.spawnShockwave(
              ev.x,
              ev.y,
              ev.isCrit || ev.isSuper ? 0xfde047 : colorHex,
              ev.isUltimate || ev.isSuper ? 3.6 : 2.5,
              0.32,
              false
            );
          }

          spawnFloatingDamage(
            ev.x,
            ev.y + 0.25,
            ev.isFinisher
              ? `K.O. -${ev.damage}!`
              : ev.isSuper
              ? `SUPER -${ev.damage}!`
              : ev.isCrit
              ? `READ! -${ev.damage}`
              : `-${ev.damage}`,
            ev.isCrit || ev.isFinisher || ev.isSuper
              ? '#fde047'
              : ev.attackerTeam === 'A'
              ? '#67e8f9'
              : '#fda4af',
            ev.isCrit || ev.isFinisher || Boolean(ev.isSuper)
          );
        }

        // Relay authoritative hit over Socket.io if we are the local attacker
        const currentRoomId = roomRef.current;
        if (currentRoomId && !isSpectatorRef.current && localTeamRef.current === ev.attackerTeam) {
          const def = ev.defenderTeam === 'A' ? engine.getActiveA() : engine.getActiveB();
          multiplayerRef.current?.emitCombatHit({
            roomId: currentRoomId,
            attackerTeam: ev.attackerTeam,
            defenderTeam: ev.defenderTeam,
            damage: ev.damage,
            isCrit: ev.isCrit,
            isBlocked: ev.isBlocked,
            isParry: ev.isParry,
            isHeavy: ev.isHeavy,
            isUltimate: ev.isUltimate,
            defenderHp: def.hp,
            defenderEliminated: def.eliminated,
            knockbackX: def.vx,
            knockbackY: def.vy,
            hitX: ev.x,
            hitY: ev.y,
          });
        }
      },
      onLocalStateSync: (fighter, activeIndex) => {
        const currentRoomId = roomRef.current;
        if (!currentRoomId || isSpectatorRef.current) return;
        multiplayerRef.current?.emitFighterState({
          roomId: currentRoomId,
          team: fighter.spec.team,
          activeIndex,
          x: fighter.x,
          y: fighter.y,
          vx: fighter.vx,
          vy: fighter.vy,
          facing: fighter.facing,
          state: fighter.state,
          stateTime: fighter.stateTime,
          hp: fighter.hp,
          shadowEnergy: fighter.shadowEnergy,
          superCharge: fighter.superCharge,
          superArmed: fighter.superArmed,
          tagCooldown: fighter.tagCooldown,
        });
      },
    });
    engineRef.current = engine;
    setHud(engine.getHUDState());

    const handleResize = () => dojo.resize();
    window.addEventListener('resize', handleResize);

    let frameId = 0;
    let lastTime = performance.now();
    let elapsed = 0;
    let hudSyncAccum = 0;

    const afterDraw = (cb: () => void) => {
      const gl = dojo.renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      if (!sync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      gl.flush();
      const poll = () => {
        const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const tick = () => {
      const now = performance.now();
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const dt = Math.min(rawDt, 0.05);
      elapsed += dt;

      if (!pausedRef.current) {
        const held = heldKeysRef.current;
        const touch = touchHeldRef.current;
        const edge = edgeQueueRef.current;

        const input: InputState = {
          left: held.has('KeyA') || held.has('ArrowLeft') || touch.left,
          right: held.has('KeyD') || held.has('ArrowRight') || touch.right,
          up: held.has('KeyW') || held.has('ArrowUp') || touch.up,
          down: held.has('KeyS') || held.has('ArrowDown') || touch.down,
          block: held.has('KeyL') || touch.block,
          lightPressed: edge.lightPressed,
          heavyPressed: edge.heavyPressed,
          dashPressed: edge.dashPressed,
          feintPressed: edge.feintPressed,
          superPressed: edge.superPressed,
          tagPressed: edge.tagPressed,
          ultimatePressed: edge.ultimatePressed,
          jumpPressed: edge.jumpPressed,
        };

        // Consume edge-triggered actions
        edge.lightPressed = false;
        edge.heavyPressed = false;
        edge.dashPressed = false;
        edge.feintPressed = false;
        edge.superPressed = false;
        edge.tagPressed = false;
        edge.ultimatePressed = false;
        edge.jumpPressed = false;

        engine.step(dt, input, elapsed);
      }

      // Update floating damage screen projections
      const activeDmgs = damagesRef.current;
      for (let i = activeDmgs.length - 1; i >= 0; i--) {
        const d = activeDmgs[i];
        d.age += dt;
        if (d.age >= d.duration) {
          activeDmgs.splice(i, 1);
          continue;
        }
        const proj = dojo.projectToScreen(d.x, d.y, d.z);
        d.screenX = proj.x;
        d.screenY = proj.y;
      }

      dojo.update(
        engine.getActiveA(),
        engine.getActiveB(),
        dt,
        elapsed,
        engine.phase === 'lobby',
        engine.finisherTimer > 0
      );

      hudSyncAccum += dt;
      if (hudSyncAccum >= 0.05) {
        hudSyncAccum = 0;
        setHud(engine.getHUDState());
        setDamages(activeDmgs.map((d) => ({ ...d })));
      }

      if (dojo.isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    if (dojo.isSoftwareGl) {
      frameId = window.setTimeout(tick, 16);
    } else {
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      if (swipeTimerRef.current !== null) clearTimeout(swipeTimerRef.current);
      window.removeEventListener('resize', handleResize);
      dojo.dispose();
    };
  }, [spawnFloatingDamage]);

  const startSoloPlay = useCallback(
    (spectatorExhibition: boolean) => {
      soundEngine.unlock();
      soundEngine.playGong();
      setPaused(false);
      setIsSoloSpectator(spectatorExhibition);
      setSoloLocalTeam(spectatorExhibition ? null : 'A');
      setSpectatorCamMode('follow');

      const { rosterA, rosterB } = buildSoloRosters(mode, { name: nickname, gender, weapon }, spectatorExhibition);
      engineRef.current?.startMatch({
        mode,
        rosterA,
        rosterB,
        localControlTeam: spectatorExhibition ? null : 'A',
        isOnline: false,
      });
      if (engineRef.current) setHud(engineRef.current.getHUDState());
    },
    [mode, nickname, gender, weapon]
  );

  // Global Keyboard Input Listeners (Combat + Spectator Free-Cam + Title Quickstart)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcuts while typing in an input box
      if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        return;
      }

      if (e.code === 'Escape' && hud.phase !== 'lobby' && hud.phase !== 'matchEnd') {
        setPaused((p) => !p);
        return;
      }

      if (hud.phase === 'lobby' && !mp.room && e.code === 'Enter') {
        startSoloPlay(false);
        return;
      }

      // Spectator camera shortcuts
      if (isSpectator && hud.phase !== 'lobby') {
        if (e.code === 'KeyF' && !e.repeat) {
          setSpectatorCamMode((prev) => (prev === 'free' ? 'follow' : 'free'));
          return;
        }
        dojoRef.current?.setFreeFlyKey(e.code, true);
        return;
      }

      const held = heldKeysRef.current;
      const wasDown = held.has(e.code);
      held.add(e.code);

      if (!wasDown) {
        const edge = edgeQueueRef.current;
        if (e.code === 'KeyJ') edge.lightPressed = true;
        if (e.code === 'KeyK') edge.heavyPressed = true;
        if (e.code === 'KeyF') edge.feintPressed = true;
        if (e.code === 'KeyR') edge.superPressed = true;
        if (e.code === 'KeyU') edge.tagPressed = true;
        if (e.code === 'KeyI') edge.ultimatePressed = true;
        if (e.code === 'KeyW' || e.code === 'ArrowUp' || e.code === 'Space') edge.jumpPressed = true;
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') edge.dashPressed = true;
        // L triggers Dash if directional key held, otherwise acts as Block hold
        if (e.code === 'KeyL' && (held.has('KeyA') || held.has('KeyD') || held.has('ArrowLeft') || held.has('ArrowRight'))) {
          edge.dashPressed = true;
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      heldKeysRef.current.delete(e.code);
      dojoRef.current?.setFreeFlyKey(e.code, false);
    };

    const onBlur = () => {
      heldKeysRef.current.clear();
      touchHeldRef.current = { left: false, right: false, up: false, down: false, block: false };
      dojoRef.current?.clearFreeFlyKeys();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [hud.phase, isSpectator, mp.room, startSoloPlay]);

  const handleTouchAction = useCallback(
    (
      action:
        | 'left'
        | 'right'
        | 'up'
        | 'down'
        | 'block'
        | 'light'
        | 'heavy'
        | 'dash'
        | 'feint'
        | 'super'
        | 'tag'
        | 'ultimate',
      pressed: boolean
    ) => {
      soundEngine.unlock();
      if (action === 'left' || action === 'right' || action === 'down' || action === 'block') {
        touchHeldRef.current[action] = pressed;
      } else if (action === 'up') {
        touchHeldRef.current.up = pressed;
        if (pressed) edgeQueueRef.current.jumpPressed = true;
      } else if (pressed) {
        if (action === 'light') edgeQueueRef.current.lightPressed = true;
        if (action === 'heavy') edgeQueueRef.current.heavyPressed = true;
        if (action === 'dash') edgeQueueRef.current.dashPressed = true;
        if (action === 'feint') edgeQueueRef.current.feintPressed = true;
        if (action === 'super') edgeQueueRef.current.superPressed = true;
        if (action === 'tag') edgeQueueRef.current.tagPressed = true;
        if (action === 'ultimate') edgeQueueRef.current.ultimatePressed = true;
      }
    },
    []
  );

  // Touch Swipe Detection anywhere on screen (Up/Down/Left/Right) for mobile players
  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (hud.phase === 'lobby' || hud.phase === 'matchEnd' || paused || isSpectator) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('button, input, textarea, a')) return;
      const t = e.touches[0];
      if (t) {
        swipeOriginRef.current = { x: t.clientX, y: t.clientY };
      }
    },
    [hud.phase, paused, isSpectator]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      const origin = swipeOriginRef.current;
      swipeOriginRef.current = null;
      if (!origin || hud.phase === 'lobby' || hud.phase === 'matchEnd' || paused || isSpectator) return;

      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - origin.x;
      const dy = t.clientY - origin.y;
      if (Math.hypot(dx, dy) < 34) return;

      soundEngine.unlock();
      if (swipeTimerRef.current !== null) {
        clearTimeout(swipeTimerRef.current);
      }

      if (Math.abs(dx) > Math.abs(dy)) {
        const dirKey = dx > 0 ? 'right' : 'left';
        touchHeldRef.current.left = dirKey === 'left';
        touchHeldRef.current.right = dirKey === 'right';
        edgeQueueRef.current.dashPressed = true;
        swipeTimerRef.current = window.setTimeout(() => {
          touchHeldRef.current.left = false;
          touchHeldRef.current.right = false;
        }, 220);
      } else if (dy < 0) {
        edgeQueueRef.current.jumpPressed = true;
      } else {
        touchHeldRef.current.down = true;
        swipeTimerRef.current = window.setTimeout(() => {
          touchHeldRef.current.down = false;
        }, 280);
      }
    },
    [hud.phase, paused, isSpectator]
  );

  const handleWatchMatch = useCallback(() => {
    if (roomCodeInput.trim()) {
      mp.joinRoom(roomCodeInput.trim(), { name: nickname, gender, weapon }, mode, true);
    } else {
      startSoloPlay(true);
    }
  }, [roomCodeInput, mp, nickname, gender, weapon, mode, startSoloPlay]);

  const handleRematch = useCallback(() => {
    setPaused(false);
    if (mp.room) {
      mp.sendRematch();
    } else {
      startSoloPlay(isSoloSpectator);
    }
  }, [mp, startSoloPlay, isSoloSpectator]);

  const handleReturnLobby = useCallback(() => {
    setPaused(false);
    setIsSoloSpectator(false);
    if (mp.room) {
      mp.leaveRoom();
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      url.searchParams.delete('spectate');
      window.history.replaceState({}, '', url.toString());
    }
    engineRef.current?.setupTitleShowcase();
    if (engineRef.current) setHud(engineRef.current.getHUDState());
  }, [mp]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      soundEngine.setMuted(next);
      return next;
    });
  }, []);

  return (
    <div
      className="relative w-screen h-screen overflow-hidden bg-[#070612]"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Isolated WebGL Canvas Mount */}
      <div ref={canvasMountRef} className="fixed inset-0 z-0" />

      {/* Title & Pre-Match Lobby */}
      {hud.phase === 'lobby' && (
        <TitleLobbyScreen
          nickname={nickname}
          gender={gender}
          weapon={weapon}
          mode={mode}
          roomCodeInput={roomCodeInput}
          room={mp.room}
          myRole={mp.myRole}
          myTeam={mp.myTeam}
          socketId={mp.socketId}
          muted={muted}
          onChangeNickname={setNickname}
          onChangeGender={setGender}
          onChangeWeapon={setWeapon}
          onChangeMode={setMode}
          onChangeRoomCodeInput={setRoomCodeInput}
          onPlayVsAI={() => startSoloPlay(false)}
          onWatchMatch={handleWatchMatch}
          onCreateRoom={() => mp.createRoom(mode, { name: nickname, gender, weapon }, false)}
          onJoinRoom={(asSpec) => mp.joinRoom(roomCodeInput, { name: nickname, gender, weapon }, mode, asSpec)}
          onSwitchRole={(role: MatchRole) => mp.switchRole(role, { name: nickname, gender, weapon })}
          onStartOnlineMatch={mp.startOnlineMatch}
          onLeaveRoom={handleReturnLobby}
          onToggleMute={toggleMute}
        />
      )}

      {/* Active Combat / Spectator HUD */}
      {hud.phase !== 'lobby' && (
        <FightHUD
          hud={hud}
          damages={damages}
          isSpectator={isSpectator}
          spectatorCamMode={spectatorCamMode}
          spectatorCount={mp.room?.spectatorCount || (isSoloSpectator ? 1 : 0)}
          muted={muted}
          onToggleMute={toggleMute}
          onOpenPause={() => setPaused(true)}
          onChangeSpectatorCam={(m) => setSpectatorCamMode(m)}
          onResetSpectatorCam={() => dojoRef.current?.resetSpectatorCamera()}
          onTouchAction={handleTouchAction}
          modalOpen={paused || hud.phase === 'matchEnd'}
        />
      )}

      {/* Pause & Match End Modals */}
      {hud.phase !== 'lobby' && (paused || hud.phase === 'matchEnd') && (
        <MatchEndModal
          mode={hud.phase === 'matchEnd' ? 'matchEnd' : 'pause'}
          hud={hud}
          localTeam={activeLocalTeam}
          isSpectator={isSpectator}
          onResume={() => setPaused(false)}
          onRematch={handleRematch}
          onReturnLobby={handleReturnLobby}
        />
      )}
    </div>
  );
}
