const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');
const createServerProxy = require('./serverProxy');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('src'));
const clients = new Map();

function broadcastToAll(message, excludeSocket = null) {
    const data = JSON.stringify(message);
    for (const [socket] of clients) {
        if (socket.readyState === WebSocket.OPEN && socket !== excludeSocket) {
            socket.send(data);
        }
    }
}

wss.on('connection', (socket) => {
    const id = crypto.randomUUID();
    const entity = {
        id,
        username: undefined,
        move: 1077936132,
        connectedAt: undefined
    };

    clients.set(socket, { entity, serverProxy: null, spawned: false });

    const serverProxy = createServerProxy(socket, clients, broadcastToAll);
    clients.get(socket).serverProxy = serverProxy;

    socket.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);
            const state = clients.get(socket);
            if (!state) return;

            const fn = state.serverProxy?.[msg.type];
            if (typeof fn === 'function') {
                fn(...(msg.args || []));
            } else {
                console.warn(`Method ${msg.type} not found`);
            }
        } catch (e) {
            console.error('Error processing message', e);
        }
    });

    socket.on('close', () => {
        const state = clients.get(socket);
        if (!state) return;

        clients.delete(socket);
        if (state.spawned) {
            broadcastToAll({ type: 'leave', id: state.entity.id });
        }
    });
});

const lastPayloads = new Map();

function broadcastUpdates(clients) {
    const allEntities = [];
    for (const [, state] of clients) {
        if (state.spawned) allEntities.push(state.entity);
    }

    const payload = JSON.stringify({ type: 'update', entities: allEntities });

    for (const [socket] of clients) {
        if (socket.readyState !== WebSocket.OPEN) continue;

        const last = lastPayloads.get(socket);
        if (last === payload) continue;

        socket.send(payload);
        lastPayloads.set(socket, payload);
    }
}

setInterval(() => { broadcastUpdates(clients); }, 85);

server.listen(3000, '127.0.0.1', () => { console.log('Server running...'); });
