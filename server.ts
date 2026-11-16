import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server as SocketIOServer } from 'socket.io';
import { createServer as createViteServer } from 'vite';

type Gender = 'male' | 'female';
type WeaponClass = 'daggers' | 'katana' | 'staff';
type GameMode = '1v1' | '3v3';
type TeamId = 'A' | 'B';

interface LobbyPlayer {
  socketId: string;
  name: string;
  gender: Gender;
  weapon: WeaponClass;
  team: TeamId | 'SPECTATOR';
  ready: boolean;
  slotIndex: number;
}

interface FighterSpec {
  id: string;
  name: string;
  gender: Gender;
  weapon: WeaponClass;
  team: TeamId;
  isAI: boolean;
  ownerSocketId?: string;
}

interface RoomData {
  roomId: string;
  mode: GameMode;
  hostSocketId: string;
  status: 'waiting' | 'playing';
  players: LobbyPlayer[];
  spectators: Set<string>;
  lastMatchConfig?: {
    mode: GameMode;
    rosterA: FighterSpec[];
    rosterB: FighterSpec[];
  };
  latestStates: {
    A?: unknown;
    B?: unknown;
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

const rooms = new Map<string, RoomData>();

function generateRoomCode(): string {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `SHADOW-${num}`;
}

function buildSnapshot(room: RoomData) {
  return {
    roomId: room.roomId,
    mode: room.mode,
    hostSocketId: room.hostSocketId,
    status: room.status,
    players: room.players,
    spectatorCount: room.spectators.size,
  };
}

function buildRostersForRoom(room: RoomData): { rosterA: FighterSpec[]; rosterB: FighterSpec[] } {
  const teamAPlayers = room.players.filter((p) => p.team === 'A');
  const teamBPlayers = room.players.filter((p) => p.team === 'B');

  const fillSquad = (humans: LobbyPlayer[], team: TeamId): FighterSpec[] => {
    const count = room.mode === '3v3' ? 3 : 1;
    const result: FighterSpec[] = [];
    const fallbackNames = team === 'A' ? ['Kuro', 'Raiden', 'Ren'] : ['Akane', 'Viper', 'Kenshin'];
    const fallbackWeapons: WeaponClass[] = ['katana', 'daggers', 'staff'];
    const fallbackGenders: Gender[] = ['male', 'female', 'male'];

    for (let i = 0; i < count; i++) {
      const h = humans[i];
      if (h) {
        result.push({
          id: `${team}-${i}-${h.socketId}`,
          name: h.name,
          gender: h.gender,
          weapon: h.weapon,
          team,
          isAI: false,
          ownerSocketId: h.socketId,
        });
      } else if (humans.length > 0 && room.mode === '3v3') {
        // Squad teammate controlled by team's primary human player via tag-in!
        const lead = humans[0];
        result.push({
          id: `${team}-ally-${i}`,
          name: `${fallbackNames[i]} (${lead.name})`,
          gender: fallbackGenders[(i + 1) % 3],
          weapon: fallbackWeapons[(i + 1) % 3],
          team,
          isAI: false,
          ownerSocketId: lead.socketId,
        });
      } else {
        result.push({
          id: `${team}-ai-${i}`,
          name: fallbackNames[i],
          gender: fallbackGenders[i % 3],
          weapon: fallbackWeapons[i % 3],
          team,
          isAI: true,
        });
      }
    }
    return result;
  };

  return {
    rosterA: fillSquad(teamAPlayers, 'A'),
    rosterB: fillSquad(teamBPlayers, 'B'),
  };
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.size });
  });

  io.on('connection', (socket) => {
    let currentRoomId: string | null = null;

    const leaveCurrentRoom = () => {
      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (room) {
        room.players = room.players.filter((p) => p.socketId !== socket.id);
        room.spectators.delete(socket.id);
        if (room.hostSocketId === socket.id && room.players.length > 0) {
          room.hostSocketId = room.players[0].socketId;
        }
        if (room.players.length === 0 && room.spectators.size === 0) {
          rooms.delete(currentRoomId);
        } else {
          io.to(currentRoomId).emit('room:update', buildSnapshot(room));
        }
      }
      socket.leave(currentRoomId);
      currentRoomId = null;
    };

    socket.on('room:create', (data: { mode: GameMode; player: { name: string; gender: Gender; weapon: WeaponClass }; asSpectator?: boolean }) => {
      leaveCurrentRoom();
      let code = generateRoomCode();
      while (rooms.has(code)) code = generateRoomCode();

      const mode: GameMode = data.mode === '3v3' ? '3v3' : '1v1';
      const room: RoomData = {
        roomId: code,
        mode,
        hostSocketId: socket.id,
        status: 'waiting',
        players: [],
        spectators: new Set<string>(),
        latestStates: {},
      };

      if (data.asSpectator) {
        room.spectators.add(socket.id);
      } else {
        room.players.push({
          socketId: socket.id,
          name: data.player?.name || 'Shadow',
          gender: data.player?.gender === 'female' ? 'female' : 'male',
          weapon: data.player?.weapon || 'katana',
          team: 'A',
          ready: true,
          slotIndex: 0,
        });
      }

      rooms.set(code, room);
      currentRoomId = code;
      socket.join(code);

      const snapshot = buildSnapshot(room);
      socket.emit('room:joined', { snapshot, role: data.asSpectator ? 'spectator' : 'player', team: data.asSpectator ? null : 'A' });
      io.to(code).emit('room:update', snapshot);
    });

    socket.on('room:join', (data: { roomId: string; mode?: GameMode; player: { name: string; gender: Gender; weapon: WeaponClass }; asSpectator?: boolean }) => {
      leaveCurrentRoom();
      const cleanId = (data.roomId || '').trim().toUpperCase();
      if (!cleanId) return;

      let room = rooms.get(cleanId);
      if (!room) {
        room = {
          roomId: cleanId,
          mode: data.mode === '3v3' ? '3v3' : '1v1',
          hostSocketId: socket.id,
          status: 'waiting',
          players: [],
          spectators: new Set<string>(),
          latestStates: {},
        };
        rooms.set(cleanId, room);
      }

      const maxPerTeam = room.mode === '3v3' ? 3 : 1;
      const countA = room.players.filter((p) => p.team === 'A').length;
      const countB = room.players.filter((p) => p.team === 'B').length;

      let assignedRole: 'player' | 'spectator' = 'player';
      let assignedTeam: TeamId | null = null;

      if (data.asSpectator || room.status === 'playing' || (countA >= maxPerTeam && countB >= maxPerTeam)) {
        assignedRole = 'spectator';
        room.spectators.add(socket.id);
      } else {
        assignedTeam = countA <= countB ? 'A' : 'B';
        const slotIndex = assignedTeam === 'A' ? countA : countB;
        room.players.push({
          socketId: socket.id,
          name: data.player?.name || 'Shadow',
          gender: data.player?.gender === 'female' ? 'female' : 'male',
          weapon: data.player?.weapon || 'katana',
          team: assignedTeam,
          ready: true,
          slotIndex,
        });
      }

      currentRoomId = cleanId;
      socket.join(cleanId);

      const snapshot = buildSnapshot(room);
      socket.emit('room:joined', { snapshot, role: assignedRole, team: assignedTeam });
      io.to(cleanId).emit('room:update', snapshot);

      // If match already running and a spectator joined via link, immediately sync them into the arena!
      if (room.status === 'playing' && room.lastMatchConfig) {
        socket.emit('match:start', {
          ...room.lastMatchConfig,
          latestStates: room.latestStates,
        });
      }
    });

    socket.on('room:switchRole', (data: { roomId: string; role: 'player' | 'spectator'; player: { name: string; gender: Gender; weapon: WeaponClass } }) => {
      const room = rooms.get(data.roomId);
      if (!room) return;

      if (data.role === 'spectator') {
        room.players = room.players.filter((p) => p.socketId !== socket.id);
        room.spectators.add(socket.id);
        if (room.hostSocketId === socket.id && room.players.length > 0) {
          room.hostSocketId = room.players[0].socketId;
        }
        socket.emit('room:roleChanged', { role: 'spectator', team: null });
      } else {
        const maxPerTeam = room.mode === '3v3' ? 3 : 1;
        const countA = room.players.filter((p) => p.team === 'A').length;
        const countB = room.players.filter((p) => p.team === 'B').length;
        if (countA < maxPerTeam || countB < maxPerTeam) {
          room.spectators.delete(socket.id);
          const team: TeamId = countA <= countB ? 'A' : 'B';
          const slotIndex = team === 'A' ? countA : countB;
          room.players.push({
            socketId: socket.id,
            name: data.player?.name || 'Shadow',
            gender: data.player?.gender === 'female' ? 'female' : 'male',
            weapon: data.player?.weapon || 'katana',
            team,
            ready: true,
            slotIndex,
          });
          if (!room.players.some((p) => p.socketId === room.hostSocketId)) {
            room.hostSocketId = socket.id;
          }
          socket.emit('room:roleChanged', { role: 'player', team });
        }
      }
      io.to(room.roomId).emit('room:update', buildSnapshot(room));
    });

    socket.on('room:updateProfile', (data: { roomId: string; name: string; gender: Gender; weapon: WeaponClass; ready: boolean }) => {
      const room = rooms.get(data.roomId);
      if (!room) return;
      const p = room.players.find((pl) => pl.socketId === socket.id);
      if (p) {
        p.name = data.name || p.name;
        p.gender = data.gender;
        p.weapon = data.weapon;
        p.ready = data.ready;
        io.to(room.roomId).emit('room:update', buildSnapshot(room));
      }
    });

    socket.on('room:start', (data: { roomId: string }) => {
      const room = rooms.get(data.roomId);
      if (!room) return;
      room.status = 'playing';
      const rosters = buildRostersForRoom(room);
      room.lastMatchConfig = { mode: room.mode, ...rosters };
      room.latestStates = {};
      io.to(room.roomId).emit('match:start', room.lastMatchConfig);
      io.to(room.roomId).emit('room:update', buildSnapshot(room));
    });

    socket.on('fighter:state', (payload: { roomId: string; team: TeamId }) => {
      const room = rooms.get(payload.roomId);
      if (room) {
        if (payload.team === 'A') room.latestStates.A = payload;
        else room.latestStates.B = payload;
      }
      socket.to(payload.roomId).emit('fighter:state', payload);
    });

    socket.on('combat:hit', (payload: { roomId: string }) => {
      socket.to(payload.roomId).emit('combat:hit', payload);
    });

    socket.on('match:rematch', (data: { roomId: string }) => {
      const room = rooms.get(data.roomId);
      if (!room) return;
      room.status = 'playing';
      const rosters = buildRostersForRoom(room);
      room.lastMatchConfig = { mode: room.mode, ...rosters };
      room.latestStates = {};
      io.to(room.roomId).emit('match:start', room.lastMatchConfig);
    });

    socket.on('room:leave', () => {
      leaveCurrentRoom();
    });

    socket.on('disconnect', () => {
      leaveCurrentRoom();
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`KAGE: Twilight Duel server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
