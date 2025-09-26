import WebSocket from "ws";
import { BinaryReader, BinaryWriter, encoder, Tuple, Opcode } from './binary';

interface Entity {
    id: string;
    username?: string;
    move: bigint;
    connectedAt?: bigint;
}

interface ClientState {
    entity: Entity;
    serverProxy: Record<string, (...args: any[]) => void> | null;
    spawned: boolean;
}

type ClientsMap = Map<WebSocket, ClientState>;

export default function createServerProxy(
    socket: WebSocket,
    clients: ClientsMap,
    broadcastToAll: (payload: ArrayBuffer, excludeSocket?: WebSocket | null) => void
): Record<string, (...args: any[]) => void> {
    return {
        handleOpcode(opcode: number, view: DataView) {
            const state = clients.get(socket);
            if (!state) return;

            switch (opcode) {
                case Opcode.JOINED: {
                    if (state.spawned) return;
                    const reader = new BinaryReader(view.buffer as ArrayBuffer);
                    const Vec1f = new Tuple(['string']);
                    const [username] = Vec1f.read(reader, 1) as [string];

                    state.entity.username = username.trim();
                    state.entity.connectedAt = BigInt(Date.now());
                    state.spawned = true;

                    // encodeJoined:
                    const idBytes = encoder.encode(state.entity.id);
                    const userBytes = encoder.encode(state.entity.username ?? "");
                    const totalSize = 1 + 2 + idBytes.length + 2 + userBytes.length + 8 + 8;
                    const writer = new BinaryWriter(new ArrayBuffer(totalSize));
                    writer.writeU8(Opcode.JOINED);
                    writer.writeString(state.entity.id);
                    writer.writeString(state.entity.username);
                    writer.writeU64(state.entity.move);
                    writer.writeU64(state.entity.connectedAt);
                    socket.send(writer.buffer); // send [id, username, move, connectedAt]
                    console.log(`[system] ${username} joined the game`);
                    break;
                }

                case Opcode.SAY: {
                    if (!state.spawned) return;
                    broadcastToAll(view.buffer as ArrayBuffer, socket);
                    break;
                }

                case Opcode.MOVE: {
                    if (!state.spawned) return;
                    const reader = new BinaryReader(view.buffer as ArrayBuffer);
                    const Vec2f = new Tuple(['string', 'u64']);
                    const [id, move] = Vec2f.read(reader, 1) as [string, bigint];
                    Object.assign(state.entity, { id, move: move });
                    break;
                }

                case Opcode.PING: {
                    if (!state.spawned) return;
                    socket.send(view.buffer as ArrayBuffer);
                    break;
                }

                default:
                    console.warn(`Unknown opcode: ${opcode}`);
            }
        }
    };
}
