import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerMessage } from "./scoreboard";
import { characterAnimations } from "./characterAnimations";

async function startServer(path: string) {
  const process = Bun.spawn([Bun.which("bun")!, "run", "server.ts"], {
    cwd: join(import.meta.dir, ".."),
    env: { ...Bun.env, HOST: "127.0.0.1", API_PORT: "0", EVENT_STORE_PATH: path },
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = process.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`Server exited before startup: ${await new Response(process.stderr).text()}`);
      output += decoder.decode(chunk.value, { stream: true });
      const url = output.match(/Scoreboard running at (http:\/\/localhost:\d+)/)?.[1];
      if (url) return { process, url: url.replace("localhost", "127.0.0.1") };
    }
  } catch (error) {
    process.kill();
    await process.exited;
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function client(url: string) {
  const socket = new WebSocket(url.replace("http:", "ws:") + "/ws");
  const messages: ServerMessage[] = [];
  let notify: (() => void) | undefined;
  socket.addEventListener("message", ({ data }) => {
    messages.push(JSON.parse(String(data)) as ServerMessage);
    notify?.();
  });
  async function next(): Promise<ServerMessage> {
    if (messages.length) return messages.shift()!;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        notify = undefined;
        reject(new Error("Timed out waiting for a WebSocket message."));
      }, 3000);
      notify = () => {
        clearTimeout(timer);
        notify = undefined;
        resolve();
      };
    });
    return messages.shift()!;
  }
  return { socket, next };
}

test("broadcasts committed state and situations to all clients, reports failures, and restores on restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scoreboard-server-"));
  const path = join(directory, "events.sqlite");
  let running: Awaited<ReturnType<typeof startServer>> | undefined;
  const clients: ReturnType<typeof client>[] = [];
  try {
    running = await startServer(path);
    const editor = client(running.url);
    const board = client(running.url);
    clients.push(editor, board);
    const initial = await editor.next();
    expect(initial.type).toBe("state");
    if (initial.type !== "state") throw new Error("Expected initial state.");
    expect(await board.next()).toEqual(initial);
    expect(await (await fetch(running.url + "/api/state")).json()).toEqual(initial.state);
    const adminPage = await fetch(running.url + "/admin");
    expect(adminPage.status).toBe(200);
    expect(await adminPage.text()).toContain("<title>Administration");
    const animationPage = await fetch(running.url + "/animation-debug.html");
    expect(animationPage.status).toBe(200);
    expect(await animationPage.text()).toContain("<title>Animation Debug");
    const logoResponse = await fetch(running.url + "/reppischfaeger-logo.svg");
    expect(logoResponse.status).toBe(200);
    expect(logoResponse.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(await logoResponse.text()).toContain('id="circle"');
    for (const filename of ["micky.glb", ...characterAnimations.map(({ id }) => `${id}.glb`)]) {
      const modelResponse = await fetch(running.url + "/models/" + filename);
      expect(modelResponse.status).toBe(200);
      expect(modelResponse.headers.get("Content-Type")).toBe("model/gltf-binary");
      const bytes = new Uint8Array(await modelResponse.arrayBuffer());
      expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("glTF");
      expect(new DataView(bytes.buffer).getUint32(8, true)).toBe(bytes.byteLength);
    }
    const initialStatistics = await fetch(running.url + "/api/statistics");
    expect(initialStatistics.headers.get("Cache-Control")).toBe("no-store");
    expect(await initialStatistics.json()).toMatchObject({
      stateUpdatedAt: initial.state.updatedAt,
      teams: initial.state.teams.map(({ id }) => ({ teamId: id, drinksLast30Minutes: 0, leaderMilliseconds: 0 })),
    });

    editor.socket.send(JSON.stringify({ type: "reset" }));
    expect((await editor.next()).type).toBe("state");
    expect((await board.next()).type).toBe("state");
    if (initial.state.teams.some(({ drinks }) => drinks > 0)) {
      expect((await editor.next()).type).toBe("events");
      expect((await board.next()).type).toBe("events");
    }

    const id = initial.state.teams[0]!.id;
    editor.socket.send(JSON.stringify({ type: "set-drinks", id, drinks: 100 }));
    const updated = await editor.next();
    expect(updated.type).toBe("state");
    if (updated.type !== "state") throw new Error("Expected updated state.");
    expect(await board.next()).toEqual(updated);
    const situations = await editor.next();
    expect(situations.type).toBe("events");
    if (situations.type !== "events") throw new Error("Expected situations.");
    expect(situations.events).toEqual([
      expect.objectContaining({ type: "leaders-changed", previousLeaderIds: [], leaderIds: [id] }),
      expect.objectContaining({ type: "team-milestone", teamId: id, milestone: 100 }),
    ]);
    expect(await board.next()).toEqual(situations);
    expect(await (await fetch(running.url + "/api/statistics")).json()).toMatchObject({
      stateUpdatedAt: updated.state.updatedAt,
      teams: expect.arrayContaining([expect.objectContaining({ teamId: id, drinksLast30Minutes: 100 })]),
    });
    const database = new Database(path);
    try {
      const latest = database.query<{ id: number }, []>("SELECT id FROM events ORDER BY id DESC LIMIT 1").get()!;
      expect(situations.events.every(({ sourceEventId }) => sourceEventId === latest.id)).toBe(true);
      database.exec("CREATE TRIGGER fail_write BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'write failed'); END;");
      editor.socket.send(JSON.stringify({ type: "adjust-drinks", id, amount: 1 }));
      expect(await editor.next()).toMatchObject({ type: "error", message: expect.stringContaining("gespeichert") });
      expect(await (await fetch(running.url + "/api/state")).json()).toEqual(updated.state);
      database.exec("DROP TRIGGER fail_write");
    } finally {
      database.close();
    }

    editor.socket.send("not json");
    expect(await editor.next()).toMatchObject({ type: "error" });
    editor.socket.send(JSON.stringify({ type: "adjust-drinks", id: "missing", amount: 1 }));
    expect(await editor.next()).toMatchObject({ type: "error" });
    for (const connected of clients.splice(0)) connected.socket.close();
    running.process.kill();
    await running.process.exited;

    running = await startServer(path);
    const reconnected = client(running.url);
    clients.push(reconnected);
    expect(await reconnected.next()).toEqual(updated);
    expect(await (await fetch(running.url + "/api/state")).json()).toEqual(updated.state);
    reconnected.socket.send(JSON.stringify({ type: "adjust-drinks", id, amount: 1 }));
    // Historical situations must not be queued ahead of the next state message.
    expect((await reconnected.next()).type).toBe("state");
  } finally {
    for (const connected of clients) connected.socket.close();
    if (running) {
      running.process.kill();
      await running.process.exited;
    }
    await rm(directory, { recursive: true });
  }
}, 20000);
