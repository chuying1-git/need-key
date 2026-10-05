/**
 * Simple presence WebSocket server for need-key site.
 * - Accepts JSON messages from clients:
 *   { type: 'join'|'hb'|'leave', id, meta, ts }
 * - Broadcasts presence list:
 *   { type: 'presence', list: [{id, meta, lastSeen}, ...] }
 * - Also broadcasts individual join/leave messages:
 *   { type: 'join', id, meta, lastSeen } / { type: 'leave', id }
 *
 * Usage:
 *   NODE_ENV=production PORT=8080 node presence-server.js
 *
 * For production use behind TLS/reverse-proxy to enable wss://
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

// Optional: serve a ./public directory for testing (put client files there)
app.use(express.static('public'));

app.get('/health', (req, res) => res.send({ ok: true, ts: Date.now() }));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Presence maps:
// presence: id -> { meta, lastSeen: number, conns: Set<WebSocket> }
const presence = new Map();
// clients: ws -> id
const clients = new Map();

const HEARTBEAT_TIMEOUT_MS = 15000; // if not seen for this, consider offline
const BROADCAST_INTERVAL_MS = 5000; // periodic broadcast

function safeJSON(obj) {
  try { return JSON.stringify(obj); } catch (e) { return null; }
}

function broadcast(obj) {
  const str = safeJSON(obj);
  if (!str) return;
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) {
      try { c.send(str); } catch (e) { /* ignore */ }
    }
  });
}

function broadcastPresenceList() {
  const now = Date.now();
  const list = Array.from(presence.entries()).map(([id, v]) => ({
    id,
    meta: v.meta || {},
    lastSeen: v.lastSeen || now
  }));
  broadcast({ type: 'presence', list });
}

function handleJoin(id, meta, ts, ws) {
  let entry = presence.get(id);
  if (!entry) {
    entry = { meta: meta || {}, lastSeen: ts || Date.now(), conns: new Set() };
    presence.set(id, entry);
  } else {
    entry.meta = Object.assign({}, entry.meta, meta || {});
    entry.lastSeen = ts || Date.now();
  }
  entry.conns.add(ws);
  clients.set(ws, id);
  // broadcast join
  broadcast({ type: 'join', id, meta: entry.meta, lastSeen: entry.lastSeen });
  // send presence list immediately to the new connection as well
  try {
    const p = safeJSON({ type: 'presence', list: Array.from(presence.entries()).map(([i, v])=>({id:i,meta:v.meta,lastSeen:v.lastSeen}))});
    if (p && ws.readyState === WebSocket.OPEN) ws.send(p);
  } catch (e) {}
}

function handleHeartbeat(id, ts) {
  const entry = presence.get(id);
  if (!entry) {
    // if heartbeat from unknown id, create minimal entry
    presence.set(id, { meta: {}, lastSeen: ts || Date.now(), conns: new Set() });
  } else {
    entry.lastSeen = ts || Date.now();
  }
}

function handleLeave(id, ws) {
  const entry = presence.get(id);
  if (!entry) return;
  if (ws && entry.conns.has(ws)) entry.conns.delete(ws);
  // if no active connections for this id, remove entry
  if (!entry.conns || entry.conns.size === 0) {
    presence.delete(id);
    broadcast({ type: 'leave', id });
  } else {
    // still have other connections, update lastSeen
    entry.lastSeen = Date.now();
    broadcastPresenceList();
  }
}

// cleanup stale presence periodically
function cleanupStale() {
  const now = Date.now();
  let changed = false;
  for (const [id, v] of presence.entries()) {
    if (now - (v.lastSeen || 0) > HEARTBEAT_TIMEOUT_MS) {
      presence.delete(id);
      broadcast({ type: 'leave', id });
      changed = true;
    }
  }
  if (changed) broadcastPresenceList();
}

// Handle incoming messages from ws
function onMessage(ws, message) {
  let msg;
  try { msg = JSON.parse(message); } catch (e) { return; }
  if (!msg || !msg.type) return;
  const { type, id, meta, ts } = msg;
  if (type === 'join') {
    if (!id) return;
    handleJoin(id, meta || {}, ts || Date.now(), ws);
    broadcastPresenceList();
  } else if (type === 'hb' || type === 'heartbeat') {
    if (!id) return;
    handleHeartbeat(id, ts || Date.now());
    // optionally broadcast lightweight update (not necessary every hb)
  } else if (type === 'leave') {
    if (!id) return;
    handleLeave(id, ws);
    broadcastPresenceList();
  }
}

// ws connection lifecycle
wss.on('connection', function connection(ws, req) {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (msg) => {
    onMessage(ws, msg);
  });

  ws.on('close', () => {
    const id = clients.get(ws);
    if (id) {
      // remove this ws from the presence entry
      const entry = presence.get(id);
      if (entry) {
        entry.conns.delete(ws);
        if (!entry.conns || entry.conns.size === 0) {
          presence.delete(id);
          broadcast({ type: 'leave', id });
        } else {
          entry.lastSeen = Date.now();
        }
      }
      clients.delete(ws);
      broadcastPresenceList();
    }
  });

  ws.on('error', () => {
    // ignore
  });
});

// periodic tasks
setInterval(() => {
  // ping clients to keep connections alive
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping(() => {});
  });
  cleanupStale();
}, 10000);

setInterval(() => {
  broadcastPresenceList();
}, BROADCAST_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`Presence server listening on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
});
