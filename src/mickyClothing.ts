import { Color, Mesh, MeshStandardMaterial, ShaderChunk, type Object3D } from "three";

export function colorMickyClothing(root: Object3D) {
  const shirt = { value: new Color() };
  const pants = { value: new Color() };
  const enabled = { value: 0 };
  let clothingMaterials = 0;
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof MeshStandardMaterial) || material.name !== "Ch14_Body" || !material.map) continue;
      clothingMaterials++;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.mickyShirt = shirt;
        shader.uniforms.mickyPants = pants;
        shader.uniforms.mickyClothingEnabled = enabled;
        shader.fragmentShader = `
          uniform vec3 mickyShirt;
          uniform vec3 mickyPants;
          uniform float mickyClothingEnabled;
        ` + shader.fragmentShader.replace("#include <map_fragment>", ShaderChunk.map_fragment.replace(
          "diffuseColor *= sampledDiffuseColor;",
          `
            // Clothing and skin share one atlas: only recolor the garment pigments.
            vec3 pigment = pow(max(sampledDiffuseColor.rgb, vec3(0.0)), vec3(1.0 / 2.2));
            float pantsMask = step(pigment.r * 1.3, pigment.g) * step(pigment.b * 1.15, pigment.g);
            float shirtRegion = step(0.16, vMapUv.x) * step(vMapUv.x, 0.415)
              * step(0.245, vMapUv.y) * step(vMapUv.y, 0.61);
            float gold = step(pigment.b * 1.4, pigment.r)
              * step(pigment.b * 1.4, pigment.g) * step(pigment.r * 0.65, pigment.g);
            float purple = step(pigment.g * 1.15, pigment.r) * step(pigment.g * 1.15, pigment.b);
            float shirtMask = shirtRegion * max(gold, purple);
            float shade = clamp(max(max(pigment.r, pigment.g), pigment.b), 0.0, 1.0);
            vec3 clothingColor = mix(mickyPants, mickyShirt, shirtMask);
            float mask = max(pantsMask, shirtMask) * mickyClothingEnabled;
            sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, clothingColor * shade, mask);
            diffuseColor *= sampledDiffuseColor;
          `,
        ));
      };
      material.customProgramCacheKey = () => "micky-clothing-v1";
      material.needsUpdate = true;
    }
  });
  if (!clothingMaterials) throw new Error("Micky's textured clothing material was not found");
  return (shirtColor?: string, pantsColor = shirtColor) => {
    enabled.value = shirtColor && pantsColor ? 1 : 0;
    if (shirtColor) shirt.value.set(shirtColor);
    if (pantsColor) pants.value.set(pantsColor);
  };
}
