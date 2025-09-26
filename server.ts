import express from "express";
import WebSocket, { WebSocketServer } from "ws";
import http from "http";
import crypto from "crypto";
import createServerProxy from "./serverProxy";
import { buffersEqual, BinaryWriter, calcEntitySize, encoder, Opcode, Struct } from "./binary";

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

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static("src"));

const clients = new Map<WebSocket, ClientState>();

function broadcastToAll(message: ArrayBuffer, excludeSocket: WebSocket | null = null) {
    for (const [client] of clients) {
        if (client !== excludeSocket && client.readyState === client.OPEN) {
            client.send(message);
        }
    }
}

function toArrayBuffer(data: WebSocket.RawData): ArrayBuffer | SharedArrayBuffer {
    if (data instanceof ArrayBuffer) {
        return data;
    } else if (Array.isArray(data)) {
        const totalLength = data.reduce((acc, buf) => acc + buf.length, 0);
        const merged = Buffer.concat(data, totalLength);
        return merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength);
    } else {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    }
}

wss.on("connection", (socket: WebSocket) => {
    const entity: Entity = {
        id: crypto.randomUUID(),
        username: "",
        move: 274882101332n,
        connectedAt: 0n,
    };

    clients.set(socket, { entity, serverProxy: null, spawned: false });

    const serverProxy = createServerProxy(socket, clients, broadcastToAll);
    clients.get(socket)!.serverProxy = serverProxy;

    socket.on("message", (raw: WebSocket.RawData) => {
        try {
            const state = clients.get(socket);
            if (!state) return;

            const buf = toArrayBuffer(raw);
            const view = new DataView(buf);

            const opcode = view.getUint8(0);
            state.serverProxy?.["handleOpcode"](opcode, view);
        } catch (e) {
            console.error("Error processing binary message", e);
        }
    });

    socket.on("close", () => {
        const state = clients.get(socket);
        if (!state) return;

        clients.delete(socket);
        if (state.spawned) {
            const idBytes = encoder.encode(state.entity.id);
            const totalSize = 1 + 2 + idBytes.length;
            const writer = new BinaryWriter(new ArrayBuffer(totalSize));
            writer.writeU8(Opcode.LEAVE);
            writer.writeString(state.entity.id);

            broadcastToAll(writer.buffer);
        }
    });
});

const lastPayloads = new Map<WebSocket, Uint8Array>();
const EntityStruct = new Struct([
    { name: "id", type: "string" },
    { name: "username", type: "string" },
    { name: "move", type: "u64" },
    { name: "connectedAt", type: "u64" },
]);

function broadcastUpdates(clients: Map<WebSocket, ClientState>) {
    const entities = Array.from(clients.values()).filter(state => state.spawned).map(state => state.entity);
    const totalSize = 1 + 2 + entities.reduce((sum, e) => sum + calcEntitySize(e), 0);

    const writer = new BinaryWriter(new ArrayBuffer(totalSize));

    writer.writeU8(Opcode.UPDATE);
    writer.writeU16(entities.length);

    for (const entity of entities) {
        EntityStruct.write(writer, {
            id: entity.id,
            username: entity.username,
            move: entity.move,
            connectedAt: entity.connectedAt ?? Date.now(),
        });
    }

    const payload = new Uint8Array(writer.buffer);

    for (const [socket] of clients) {
        if (socket.readyState !== WebSocket.OPEN) continue;

        const last = lastPayloads.get(socket);
        if (last && buffersEqual(last, payload)) continue;

        socket.send(payload);
        lastPayloads.set(socket, payload);
    }
}

setInterval(() => {
    broadcastUpdates(clients);
}, 100);

server.listen(3000, "127.0.0.1", () => {
    console.log("Server running...");
});
