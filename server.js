// signaling-server.js
import { WebSocketServer } from "ws";
const wss = new WebSocketServer({ port: 8080 });

console.log("🛰️  WebSocket server listening on ws://localhost:8080");

// Track all connected clients
const clients = new Map();

wss.on("connection", (ws) => {
  // Assign each client a random ID (you could also authenticate/jwt)
  const id = crypto.randomUUID();
  clients.set(id, ws);
  ws.send(JSON.stringify({ type: "welcome", id }));

  ws.on("message", (msg) => {
    // All messages are JSON: { to, type, payload }
    let { to, type, payload } = JSON.parse(msg);
    const dest = clients.get(to);
    if (dest && dest.readyState === WebSocket.OPEN) {
      dest.send(JSON.stringify({ from: id, type, payload }));
    }
  });

  ws.on("close", () => {
    clients.delete(id);
  });
});



