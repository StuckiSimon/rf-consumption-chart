import { useEffect, useRef, useState } from "react";
import {
  Box3, DirectionalLight, HemisphereLight,
  Mesh, PerspectiveCamera, Scene, SkinnedMesh, Texture, Vector3, WebGLRenderer,
} from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { AnimationPlayer } from "./AnimationPlayer";
import { characterAnimations, idleAnimations } from "./characterAnimations";
import { colorMickyClothing } from "./mickyClothing";
import styles from "./AnimationOverlay.module.css";

function disposeAsset(asset: GLTF) {
  const textures = new Set<Texture>();
  asset.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    if (object instanceof SkinnedMesh) object.skeleton.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value);
      }
      material.dispose();
    }
  });
  for (const texture of textures) {
    texture.dispose();
    if (typeof ImageBitmap !== "undefined" && texture.source.data instanceof ImageBitmap) {
      texture.source.data.close();
    }
  }
}

export function AnimationOverlay({ embedded = false, initialAnimation = "drunk-idle", fullBody = false, playing = true, rotateIdle = false, shirtColor, pantsColor }: {
  embedded?: boolean;
  initialAnimation?: string;
  fullBody?: boolean;
  playing?: boolean;
  rotateIdle?: boolean;
  shirtColor?: string;
  pantsColor?: string;
}) {
  const colorsRef = useRef({ shirtColor, pantsColor });
  const recolorRef = useRef<ReturnType<typeof colorMickyClothing> | null>(null);
  useEffect(() => {
    colorsRef.current = { shirtColor, pantsColor };
    recolorRef.current?.(shirtColor, pantsColor);
  }, [shirtColor, pantsColor]);
  const playingRef = useRef(playing);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  const hostRef = useRef<HTMLDivElement>(null);
  const playbackRef = useRef<{ player: AnimationPlayer; load: (url: string) => Promise<GLTF> } | null>(null);
  const [selected, setSelected] = useState(initialAnimation);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const host = hostRef.current!;
    let disposed = false;
    let renderer: WebGLRenderer | undefined;
    let player: AnimationPlayer | undefined;
    const assets: GLTF[] = [];
    let observer: ResizeObserver | undefined;
    let resize = () => {};
    setError("");
    setReady(false);

    async function start() {
      try {
        renderer = new WebGLRenderer({ alpha: true, antialias: true });
        renderer.setClearColor(0x000000, 0);
        host.appendChild(renderer.domElement);
        const scene = new Scene();
        const camera = new PerspectiveCamera(35, 1, 0.01, 1000);
        scene.add(new HemisphereLight(0xffffff, 0x596276, 2));
        const light = new DirectionalLight(0xffffff, 3);
        light.position.set(3, 4, 5);
        scene.add(light);

        const loader = new GLTFLoader();
        const cache = new Map<string, Promise<GLTF>>();
        const load = (url: string) => {
          const cached = cache.get(url);
          if (cached) return cached;
          const pending = loader.loadAsync(url).then((asset) => {
            if (disposed) disposeAsset(asset);
            else assets.push(asset);
            return asset;
          }).catch((cause: unknown) => {
            cache.delete(url);
            throw cause;
          });
          cache.set(url, pending);
          return pending;
        };
        const [character, animation] = await Promise.all([
          load("/models/micky.glb"),
          load(`/models/${initialAnimation}.glb`),
        ]);
        if (disposed) return;
        recolorRef.current = colorMickyClothing(character.scene);
        recolorRef.current(colorsRef.current.shirtColor, colorsRef.current.pantsColor);
        const clip = animation.animations[0];
        if (!clip || clip.duration <= 0) throw new Error(`${initialAnimation} contains no playable animation`);
        const bounds = new Box3().setFromObject(character.scene);
        const size = bounds.getSize(new Vector3());
        if (bounds.isEmpty() || size.y <= 0) throw new Error("Micky contains no visible geometry");
        character.scene.position.sub(bounds.getCenter(new Vector3()));
        scene.add(character.scene);
        player = new AnimationPlayer(character.scene);
        player.play(clip);
        playbackRef.current = { player, load };

        resize = () => {
          if (!renderer) return;
          const { clientWidth: width, clientHeight: height } = host;
          camera.aspect = width / Math.max(height, 1);
          const halfFov = camera.fov * Math.PI / 360;
          const cropped = embedded && !fullBody;
          const visibleHeight = cropped ? size.y * 0.65 : Math.max(size.y, size.x / camera.aspect) * 1.5;
          const distance = visibleHeight / (2 * Math.tan(halfFov));
          const targetY = cropped ? size.y * 0.24 : 0;
          camera.position.set(0, targetY, distance);
          camera.lookAt(0, targetY, 0);
          camera.updateProjectionMatrix();
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
          renderer.setSize(width, height, false);
        };
        resize();
        window.addEventListener("resize", resize);
        observer = new ResizeObserver(resize);
        observer.observe(host);
        let previousTime: number | undefined;
        renderer.setAnimationLoop((time) => {
          const delta = previousTime === undefined ? 0 : Math.min((time - previousTime) / 1000, 0.1);
          previousTime = time;
          if (playingRef.current) player!.update(delta);
          renderer!.render(scene, camera);
        });
        setReady(true);
      } catch (cause) {
        if (disposed) return;
        console.error("Could not start the character animation", cause);
        setError("Die Charakteranimation konnte nicht geladen werden.");
        renderer?.setAnimationLoop(null);
      }
    }
    void start();

    return () => {
      disposed = true;
      recolorRef.current = null;
      playbackRef.current = null;
      window.removeEventListener("resize", resize);
      observer?.disconnect();
      renderer?.setAnimationLoop(null);
      player?.dispose();
      for (const asset of assets) {
        disposeAsset(asset);
      }
      renderer?.dispose();
      renderer?.domElement.remove();
    };
  }, [embedded, initialAnimation, fullBody]);

  useEffect(() => {
    const playback = playbackRef.current;
    if (!ready || !playback) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void playback.load(`/models/${selected}.glb`).then((asset) => {
      if (cancelled) return;
      const clip = asset.animations[0];
      if (!clip || clip.duration <= 0) throw new Error(`${selected} contains no playable animation`);
      playback.player.play(clip);
    }).catch((cause: unknown) => {
      if (cancelled) return;
      console.error(`Could not switch to character animation ${selected}`, cause);
      setError("Die ausgewählte Animation konnte nicht geladen werden. Bitte erneut auswählen.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [ready, selected]);

  useEffect(() => {
    if (!rotateIdle || !ready || !playing || loading) return;
    const timer = setTimeout(() => {
      setSelected((current) => {
        if (current !== "idle") return "idle";
        const variations = idleAnimations.filter((id) => id !== "idle");
        return variations[Math.floor(Math.random() * variations.length)]!;
      });
    }, selected === "idle" ? 45_000 : 10_000);
    return () => clearTimeout(timer);
  }, [rotateIdle, ready, playing, loading, selected]);

  return (
    <div className={embedded ? styles.window : styles.overlay}>
      <div className={styles.canvasHost} ref={hostRef} role="img" aria-label="Micky" />
      {!embedded && <div className={styles.controls}>
        <label htmlFor="character-animation">Animation</label>
        <select id="character-animation" value={selected} disabled={!ready} onChange={(event) => setSelected(event.currentTarget.value)}>
          {characterAnimations.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select>
        <span role="status">{!ready ? "Charakter wird geladen …" : loading ? "Animation wird geladen …" : ""}</span>
      </div>}
      {embedded && !ready && !error && <div className={styles.windowStatus} role="status">Micky wird geladen …</div>}
      {error && <div className={styles.error} role="alert">{error}</div>}
    </div>
  );
}
