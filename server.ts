import { join } from "node:path";
import index from "./index.html";
import edit from "./edit.html";
import admin from "./admin.html";
import animationDebug from "./animation-debug.html";
import { EventStore } from "./src/eventStore";
import { characterAnimations } from "./src/characterAnimations";

const port = Number(Bun.env.API_PORT ?? Bun.env.PORT ?? (Bun.env.NODE_ENV === "development" ? 3001 : 3000));
const host = Bun.env.HOST ?? "0.0.0.0";
const store = EventStore.open(Bun.env.EVENT_STORE_PATH ?? join(import.meta.dir, "events.sqlite"));

const server = Bun.serve({
  hostname: host,
  port,
  development: false,
  routes: {
    "/": index,
    "/edit": edit,
    "/admin": admin,
    "/animation-debug.html": animationDebug,
    "/reppischfaeger-logo.svg": () => new Response(
      Bun.file(join(import.meta.dir, "public/reppischfaeger-logo.svg")),
      { headers: { "Content-Type": "image/svg+xml" } },
    ),
    "/reppischfaeger-wordmark.svg": () => new Response(
      Bun.file(join(import.meta.dir, "public/reppischfaeger-wordmark.svg")),
      { headers: { "Content-Type": "image/svg+xml" } },
    ),
    "/models/micky.glb": () => new Response(
      Bun.file(join(import.meta.dir, "public/models/micky.glb")),
      { headers: { "Content-Type": "model/gltf-binary" } },
    ),
    ...Object.fromEntries(characterAnimations.map(({ id }) => [
      `/models/${id}.glb`,
      () => new Response(
        Bun.file(join(import.meta.dir, `public/models/${id}.glb`)),
        { headers: { "Content-Type": "model/gltf-binary" } },
      ),
    ])),
    "/api/state": {
      GET() {
        return Response.json(store.state, { headers: { "Cache-Control": "no-store" } });
      },
    },
    "/api/statistics": {
      GET() {
        return Response.json(store.getStatistics(), { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
  fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      if (server.upgrade(request)) return;
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(socket) {
      socket.subscribe("scoreboard");
      socket.send(JSON.stringify({ type: "state", state: store.state }));
    },
    message(socket, rawMessage) {
      let message: unknown;
      try {
        message = JSON.parse(String(rawMessage));
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "Ungültige Nachricht." }));
        return;
      }
      let result: ReturnType<EventStore["commit"]>;
      try {
        result = store.commit(message);
      } catch (error) {
        console.error("Could not commit scoreboard update.", error);
        socket.send(JSON.stringify({ type: "error", message: "Die Änderung konnte nicht gespeichert werden. Bitte erneut versuchen." }));
        return;
      }
      if (!result) {
        socket.send(JSON.stringify({ type: "error", message: "Die Änderung konnte nicht übernommen werden." }));
        return;
      }
      server.publish("scoreboard", JSON.stringify({ type: "state", state: result.state }));
      if (result.events.length > 0) {
        server.publish("scoreboard", JSON.stringify({ type: "events", events: result.events }));
      }
    },
  },
});

console.log(`Scoreboard running at http://localhost:${server.port}`);
console.log(`Connect other devices to this computer's local network address on port ${server.port}.`);
