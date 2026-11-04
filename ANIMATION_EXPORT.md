# Character and animation export

## Outputs

| Source                          | Output                         | Contents                                                                                            |
| ------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------- |
| `raw-model/micky.fbx`           | `public/models/micky.glb`      | Skinned character, Mixamo skeleton, materials and four embedded 4096 x 4096 textures; no animation. |
| `raw-animations/*.fbx`          | `public/models/<name>.glb`    | One Mixamo skeleton and animation per source; no duplicate mesh or textures.                        |

All 27 FBXs are converted. Output filenames are lowercase and hyphenated:
`Boxing (1).fbx` becomes `boxing-1.glb`, for example. Each clip retains its
source filename stem as its name and its original frame range and frame rate.
`drunk idle.fbx` runs from frames 1 through 201 at 30 fps (6.667 seconds).
The animation-only files are not intended to display a character by themselves.

The 11 animation-pack files with different rest poses are baked onto Micky's
rest pose while preserving their original posed bone matrices and root motion.
Every bone at every sampled frame is compared against the source after baking.
Bone names, hierarchy, proportions and armature transforms must match.
The remaining 16 files already match Micky and are exported directly.

## Reproduce with Blender

Exports were generated with Blender 4.0.1. From the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender \
  --background --factory-startup --python-exit-code 1 \
  --python scripts/export-animation.py
```

On other platforms, substitute the installed `blender` executable.
The script resolves input/output paths relative to itself and performs these steps:

1. Import `raw-model/micky.fbx` into an empty scene using Blender's FBX importer.
   Preserve the imported centimeter-to-meter armature scale and bone orientations.
2. Clear the character's two-frame placeholder action and reset its pose.
   Export binary glTF with skinning/materials, embedded textures and animations disabled.
3. Import each `raw-animations/*.fbx` into a fresh scene. Compare its skeleton
   against the character; bake different rest poses onto Micky's rest pose,
   or abort for incompatible skeletons.
4. Keep its active armature action, name it after the source filename stem, and
   set the export range to the action's frame range. Remove duplicate meshes
   so their textures are not exported again.
5. Export the armature's active action with per-frame sampling, shift its start
   time to zero and use glTF's Y-up coordinate convention for both files.

Blender reports unsupported FBX `Short` user properties during import; these are
custom metadata, not the geometry or bone animation. Images remain embedded at
their original resolution; no texture downsizing or Draco decoder is required.
The exporter replaces `micky.glb` and each corresponding animation GLB;
the original FBXs and unrelated output files are unchanged.

## Three.js overlay

`animation-debug.html` is a standalone debugging page, available at
`/animation-debug.html` in both development and production-style serving.
Its separate entry point, `src/animation-debug.tsx`, mounts `AnimationOverlay`
without the scoreboard or a scoreboard WebSocket connection. The presentation lazily loads the same renderer inside the former shot-total
card, with no selector and the regular `idle.glb` animation. Its camera crops
the character to an upper-body window instead of fitting the full body.
A ResizeObserver keeps the canvas sized to its container. The edit and
administration pages do not load or render the character.
The transparent, fixed, full-window canvas ignores pointer events; only its
animation controls receive input.

The animation selector in the top-right corner lists all 27 clips. `GLTFLoader`
loads the character and initial Drunk Idle clip independently, then loads other
clips on demand and caches them for subsequent switches. The current clip keeps
playing while the next loads; superseded selections never start playback.

`AnimationPlayer` wraps an `AnimationMixer` rooted at the character and loops
each clip indefinitely. Its reusable `play(clip)` method blends over 0.6 seconds
with smoothstep easing. An interrupted transition starts from the current blend
weights without a pose jump; returning to an active clip preserves its playback
time. Faded-out actions stop after the transition. Matching exported bone names
bind every clip to the character's rig.

Event overlays recolor Micky's shirt and pants using the featured team's color.
For tied leaders, the first two teams color the shirt and pants respectively.
`mickyClothing.ts` masks the garment pigments in the shared texture atlas,
preserving skin, eyes, gloves, shoes and clothing detail. Normal idle windows
and the debug page use Reppischfäger red (`#e40134`) for both garments by default.
The camera centers/fits the character, lights it, and resizes with the viewport.
Unmounting stops rendering and disposes models, textures, skeletons and WebGL
resources, including React Strict Mode's setup/cleanup cycle. Load/render setup
failures are logged and displayed rather than silently ignored.

The Bun server serves the character and all catalogued `/models/*.glb` URLs as `model/gltf-binary`;
Vite serves them from `public/` during development. Install dependencies with
`bun install`, then use the existing `bun run dev` or `bun start` commands.
Positioning, scale and presentation gating are deliberately left for later.
