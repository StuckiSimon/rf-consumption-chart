import { expect, test } from "bun:test";
import { AnimationClip, NumberKeyframeTrack, Object3D } from "three";
import { AnimationPlayer } from "./AnimationPlayer";

function clip(name: string, position: number) {
  return new AnimationClip(name, 2, [
    new NumberKeyframeTrack(".position[x]", [0, 2], [position, position]),
  ]);
}

test("plays the initial clip immediately and smoothly blends to the next clip", () => {
  const root = new Object3D();
  const player = new AnimationPlayer(root, 1);
  player.play(clip("first", 10));
  expect(root.position.x).toBeCloseTo(10);
  player.play(clip("second", 20));
  expect(root.position.x).toBeCloseTo(10);
  player.update(0.25);
  expect(root.position.x).toBeCloseTo(11.5625);
  player.update(0.25);
  expect(root.position.x).toBeCloseTo(15);
  player.update(0.5);
  expect(root.position.x).toBeCloseTo(20);
  player.update(3);
  expect(root.position.x).toBeCloseTo(20);
  player.dispose();
});

test("interrupts a blend without a jump and can return to an already active clip", () => {
  const root = new Object3D();
  const player = new AnimationPlayer(root, 1);
  const first = clip("first", 0);
  player.play(first);
  player.play(clip("second", 10));
  player.update(0.5);
  expect(root.position.x).toBeCloseTo(5);
  player.play(clip("third", 20));
  expect(root.position.x).toBeCloseTo(5);
  player.update(0.5);
  expect(root.position.x).toBeCloseTo(12.5);
  player.play(first);
  expect(root.position.x).toBeCloseTo(12.5);
  player.update(0.5);
  expect(root.position.x).toBeCloseTo(6.25);
  player.play(first);
  player.update(0.5);
  expect(root.position.x).toBeCloseTo(0);
  player.dispose();
});
