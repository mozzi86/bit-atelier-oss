// Which mesh path a hull wall uses once a catalogue surface may be set.
//
// In:  whether a cut solid exists, whether a build-up is shown, and whether
//      render mode paints a basement in concrete.
// Out: which builder to call, and whether the assigned surface is the outer
//      band (layered) or already the single material (no build-up).
// The build-up itself stays the physics catalogue. Layer 0 is the outer band,
// the same index buildSchichtWand already treats as the assigned surface.

/**
 * @param {{ hatSolid: boolean, hatAufbau: boolean, kellerImRender: boolean }} lage
 * @returns {{ weg: "solid"|"schichten"|"koerper", aussen: boolean, einMaterial: boolean, beton: boolean }}
 */
export function huellMeshWeg(lage) {
  // A build-up is only passed in when render mode is off (the preset replaces
  // the layers). The assigned surface then colours band 0; the other bands
  // keep the build-up. Without a build-up the one shared material already is
  // the surface, or the concrete of a basement in render mode.
  if (lage.hatSolid && lage.hatAufbau) return { weg: "solid", aussen: true, einMaterial: false, beton: false };
  if (lage.hatSolid) return { weg: "solid", aussen: false, einMaterial: true, beton: !!lage.kellerImRender };
  if (lage.hatAufbau) return { weg: "schichten", aussen: true, einMaterial: false, beton: false };
  return { weg: "koerper", aussen: false, einMaterial: true, beton: !!lage.kellerImRender };
}
