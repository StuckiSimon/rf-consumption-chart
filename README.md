# Consumption Tracker

A Bun and React app for keeping one shared drinks tally across multiple teams. The frontend is written in TypeScript and styled with CSS Modules. The TV-friendly scoreboard uses a live bar chart with animated score increases and team-colored markers; the touch-friendly editor runs on phones and tablets. Updates are stored in an append-only SQLite event log and broadcast live to every connected device.

The presentation shows a cropped window onto Micky's upper body in place of the shot-total card, looping the regular Idle animation. The editor and administration views do not load or render 3D models. Open `/animation-debug.html` to preview the full character and switch between all 27 animations with smooth blending. See `ANIMATION_EXPORT.md` for conversion and playback details.

Micky also appears on both statistics screens. His speech bubble stays visible for seven seconds, then disappears without shifting the canvas. He reacts after score presentations and cinematic milestone/leadership announcements, and speaks occasionally after 25 quiet seconds. Statistics screens get a brief explanation on entry and another after 15 seconds, with quiet gaps between lines.

> **Note:** This app is not intended for deployment in a production environment. It is designed for local or internal network use only.

## Run it

1. Install [Bun](https://bun.sh/).
2. Run `bun install` to install the frontend and TypeScript tools.
3. Run `bun run dev` while developing. Vite provides React and CSS Modules HMR; Bun runs the scoreboard API and WebSocket backend.
4. In development, open `http://localhost:5173`. For production-style serving, run `bun run start` and open `http://localhost:3000`.
5. Connect the TV, phones, and tablets to the same Wi-Fi/network. In development, open `http://<host-computer-local-IP>:5173`; for production-style serving, use port `3000`. Add `/edit` on devices that will change scores.

The server prints its local URL at startup. Find the computer's local IP in its network settings if needed. Keep the TV on `/` for the passive, large-format live presentation. Use the browser's full-screen mode if desired. Open `/edit` on a separate phone or tablet to update scores, add teams, or change a team's name and color.

Score updates are batched for the presentation, starting with a 350 ms collection window. Pending snapshots are merged into the newest state so rapid taps do not cause repeated scrolling trips. If an existing team's count increases outside the visible area, the board first scrolls that team into view, then animates the count. Updates received while scrolling, counting, or holding are included in the same visit. After counting finishes, rankings reorder after 600 ms when scrolled down, or 150 ms otherwise, once incoming updates have settled. The reordered board remains on screen for 1.8 seconds before returning to the top, and returns only when no updates remain; a new update during the return interrupts it. Rankings remain stable during counting. Cinematic announcements pause the scoreboard sequence. Reduced-motion preferences use instant scrolling.

After one minute without updates or active presentations, the screen shows one statistics chart for 30 seconds, then returns to the normal scoreboard and waits another minute. Idle visits alternate between **shots recorded in the last 30 minutes** and **accumulated hours and minutes at #1**. A short, layered logo transition covers every switch. Any committed update returns the display to the normal scoreboard through the same transition, before pending score animations or event announcements resume. Idle charts are disabled while disconnected.

Statistics are rebuilt from the SQLite event log at startup, including history from before the display was opened. Positive score changes count as newly recorded shots; decreases and resets do not subtract previously recorded shots from the rolling window. Initial scores are not new shots. Leadership includes all teams tied for the highest positive score, accumulates across separate periods, and stops when all scores are zero. Removed teams are omitted. `/api/statistics` returns a non-cached snapshot for the current teams; idle charts refresh it every 10 seconds. A failed initial request reports an error and leaves the normal scoreboard visible.

The separate **Administration** page at `/admin` contains **Start der Zeitwertung**, which selects a date and time in the device's local timezone. Open it using the Administration link in the `/edit` page heading; score management stays on `/edit`. This is a separate settings view, not an authentication boundary. Saving persists the timestamp as a `scoring-start-set` event in SQLite and shares it with all clients. Only time at #1 on or after this timestamp counts, including partial leadership periods crossing the start. Moving the start earlier or later recalculates from history; a future start yields zero until that time. Shot totals and the rolling 30-minute chart are unaffected. Without a selected start, all recorded leadership history counts. Team changes and count resets preserve this setting.

The production-style server defaults to port `3000`; development uses Vite on `5173` with the Bun API/WebSocket server on `3001`. Both listen on all network interfaces. Override ports with `PORT`/`HOST` for `bun run start`, or `VITE_PORT`/`API_PORT` for development.

This app is intended for a trusted local network and has no authentication; anyone who can reach it can edit the scoreboard.

## Event storage

`events.sqlite` beside the server is the source of truth (override with `EVENT_STORE_PATH`). The server rebuilds its in-memory scoreboard by replaying events in ID order at startup. Each accepted update records a timestamped fact: team added, renamed, recolored or removed, shot counts set or incremented, or all counts reset. Resetting counts and removing teams never erase history.

On the first start with an empty event log, the server initializes the usual two teams in SQLite. A corrupt event history stops startup rather than silently discarding scores.

Updates are processed serially and committed with SQLite transactions and full synchronous durability before changing the in-memory projection or broadcasting. A failed write returns a WebSocket error and leaves the projection unchanged. Run only one backend process per database; stale writers are rejected. To back up the data, stop the server first and copy the database and any remaining `-wal`/`-shm` sidecars together.

## Backend events

WebSocket clients still receive `{ type: "state", state }` on connection and after each committed update. After that state message, updates that trigger situations also send `{ type: "events", events: [...] }`. Each event has `sourceEventId` (the durable update's ID) and `occurredAt`, plus:

| Type              | Fields                           | Trigger                                                                                                                                                 |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `leaders-changed` | `previousLeaderIds`, `leaderIds` | The set of teams tied for the highest positive count changes. All-zero counts mean no leader. Corrections, removals and resets can also change leaders. |
| `team-milestone`  | `teamId`, `milestone`            | An upward team score change crosses a multiple of 50 (50, 100, 150, 200, 250, and so on).                                                               |

Large score corrections emit only the highest crossed milestone per team, not one event per skipped threshold. There are no overall-total milestone events. Decreases and resets do not emit milestones; crossing a threshold again after a correction or reset emits it again. Initialization and replay never send historical situation events. Reconnecting clients receive the current state, not missed notifications. These events are live notifications, not a durable delivery queue.

Types are shared in `src/scoreboard.ts`. The presentation queues live situation events and announces them one at a time. Each announcement fades to a dark backdrop and builds the original SVG logo: the unmasked circle, trumpet growing from its lower-left tip, three waves moving inward from the circle, red lettering with matching circle cutouts, and finally the bottom lettering fading and expanding outward from inside the circle. The completed logo fades into the event announcement before returning to the scoreboard. Reduced-motion preferences disable the SVG's movement and staggered reveal. The editor does not play announcements.

Major team milestones (100, 200, 300, and so on) and new outright leaders show a brief shower of red, yellow, and blue confetti with the event heading. Confetti uses the lazily loaded `@tsparticles/confetti` bundle with randomized bursts, gravity, wobble, and tumbling on a canvas behind the text. The particle engine is destroyed when the announcement ends. Ties, resets, and the intervening 50-shot milestones do not show confetti. Confetti is disabled for reduced-motion preferences.

Run `bun test` for event storage and situation tests. Run `bun run check` to type-check the app, build the frontend, and verify the Bun server build.
