// server.js // temp file
const express = require('express');
// const session = require('express-session');
const WebSocket = require('ws');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
// const authRouter = require('./routes/auth');

const app = express();

app.use(express.json());
// app.use(session({
//     secret: 'clave_super_secreta',
//     resave: false,
//     saveUninitialized: true,
//     cookie: { secure: false } // true si usas HTTPS
// }));

// Routes
// app.use('/auth', authRouter);

// const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('src'));

const clients = new Map(); // socket -> { entity, serverProxy, spawned }

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
        x: 64,
        y: 64,
        queue: [],
        keys: { axisX: 0, axisY: 0, shift: 0 },
        connectedAt: undefined
    };

    // Estado: aún no "spawneado"
    clients.set(socket, { entity, serverProxy: null, spawned: false });

    const serverProxy = new Proxy({}, {
        get: (_, key) => (...args) => {
            const state = clients.get(socket);
            if (!state) return;

            switch (key) {
                case 'newPlayer': {
                    if (state.spawned) return;
                    const [data] = args || [];
                    const username = data?.username;
                    if (typeof username !== 'string' || !username.trim()) {
                        socket.send(JSON.stringify({ type: 'error', message: 'Username inválido' }));
                        return;
                    }

                    state.entity.username = username.trim();
                    state.entity.connectedAt = Date.now();
                    state.spawned = true;

                    // Enviar playerJoined SOLO al nuevo
                    socket.send(JSON.stringify({ type: 'playerJoined', entity: state.entity }));
                    console.log("playerJoined");
                    break;
                }

                case 'say': {
                    if (!state.spawned) return;
                    const [entityId, message, chatType] = args;
                    broadcastToAll({ type: 'say', entityId, message, chatType }, socket);
                    socket.send(JSON.stringify({ type: 'say', entityId, message, chatType })); // eco al propio
                    break;
                }

                case 'syncPlayer': {
                    if (!state.spawned) return;
                    const [data] = args || [];
                    Object.assign(state.entity, data);
                    break;
                }

                default:
                    console.warn(`Method ${key} not defined in serverProxy`);
            }
        }
    });

    // guardar proxy
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
                console.warn(`Método ${msg.type} no encontrado`);
            }
        } catch (e) {
            console.error('Error procesando mensaje', e);
        }
    });

    socket.on('close', () => {
        const state = clients.get(socket);
        if (!state) return;

        clients.delete(socket);
        if (state.spawned) {
            broadcastToAll({ type: 'playerLeft', id: state.entity.id });
        }
    });
});

setInterval(() => {
    const allEntities = [];
    for (const [, state] of clients) {
        if (state.spawned) allEntities.push(state.entity);
    }
    const payload = JSON.stringify({ type: 'update', entities: allEntities });
    for (const [socket] of clients) {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(payload);
        }
    }
}, 100);

const options = {
    key: fs.readFileSync('key.pem'),
    cert: fs.readFileSync('cert.pem')
};

const PORT = 3000;
https.createServer(options, app).listen(PORT, () => {
  console.log(`HTTPS Server running at https://localhost:${PORT}`);
});
