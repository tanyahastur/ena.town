// serverProxy.js
module.exports = function createServerProxy(socket, clients, broadcastToAll) {
    return new Proxy({}, {
        get: (_, key) => (...args) => {
            const state = clients.get(socket);
            if (!state) return;

            switch (key) {
                case 'joined': {
                    if (state.spawned) return;
                    const [data] = args || [];
                    const username = data?.username;
                    if (typeof username !== 'string' || !username.trim()) {
                        socket.send(JSON.stringify({ type: 'error', message: 'Invalid username' }));
                        return;
                    }

                    state.entity.username = username.trim();
                    state.entity.connectedAt = Date.now();
                    state.spawned = true;

                    socket.send(JSON.stringify({ type: 'joined', entity: state.entity }));
                    console.log(`[system] ${state.entity.username} joined the game`);
                    break;
                }

                case 'say': {
                    if (!state.spawned) return;
                    const [entityId, message, chatType] = args;
                    broadcastToAll({ type: 'say', entityId, message, chatType }, socket);
                    socket.send(JSON.stringify({ type: 'say', entityId, message, chatType }));
                    break;
                }

                case 'sync': {
                    if (!state.spawned) return;
                    const [data] = args || [];
                    Object.assign(state.entity, data);
                    break;
                }

                case 'ping': {
                    if (!state.spawned) return;
                    const [timestamp] = args || [];
                    socket.send(JSON.stringify({ type: 'pong', ms: timestamp }));
                    break;
                }

                default:
                    console.warn(`Method ${key} not defined in serverProxy`);
            }
        }
    });
}
