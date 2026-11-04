import { AnimationMixer, LoopRepeat, type AnimationAction, type AnimationClip, type Object3D } from "three";

export class AnimationPlayer {
  private readonly mixer: AnimationMixer;
  private readonly weights = new Map<AnimationAction, number>();
  private target: AnimationAction | undefined;
  private elapsed = 0;

  constructor(private readonly root: Object3D, private readonly transitionSeconds = 0.6) {
    this.mixer = new AnimationMixer(root);
  }

  play(clip: AnimationClip) {
    const action = this.mixer.clipAction(clip);
    if (action === this.target) return;
    if (!this.weights.has(action)) {
      action.reset().setLoop(LoopRepeat, Infinity).setEffectiveWeight(0).play();
      this.weights.set(action, 0);
    }
    // Capture the current blend so interrupted transitions never jump.
    for (const active of this.weights.keys()) {
      this.weights.set(active, active.getEffectiveWeight());
    }
    const first = !this.target;
    this.target = action;
    this.elapsed = first ? this.transitionSeconds : 0;
    this.update(0);
  }

  update(delta: number) {
    this.elapsed += delta;
    const progress = this.transitionSeconds <= 0 ? 1 : Math.min(this.elapsed / this.transitionSeconds, 1);
    const blend = progress * progress * (3 - 2 * progress);
    for (const [action, start] of this.weights) {
      action.setEffectiveWeight(start + ((action === this.target ? 1 : 0) - start) * blend);
      if (progress === 1 && action !== this.target) {
        action.stop();
        this.weights.delete(action);
      }
    }
    this.mixer.update(delta);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.weights.clear();
    this.target = undefined;
  }
}
