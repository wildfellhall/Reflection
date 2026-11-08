/** All dimensions in metres. The pane, cut edge, backing, and rim share a scale. */
export const MIRROR = {
  width: 0.125,
  height: 0.17,
  glassThickness: 0.003,
  bevelWidth: 0.004,
  bevelDrop: 0.0015,
  frameWidth: 0.012,
  handleCompression: .68,
  glassIOR: 1.52,
  // Absorption per metre; the thin antique pane is nearly neutral at its center.
  absorption: [1.5, 0.35, 0.65] as const,
  silverReflectance: [0.965, 0.97, 0.975] as const,
  environmentRotation: 3.4,
  environmentExposure: 1.1,
  // Maximum live-field contribution to the resolved silver lobe. Front glass
  // and broad scattering use much weaker, separately filtered contributions.
  cameraIntegration: .34,
  cameraExposure: 1.08,
  cameraSaturation: .22,
  faceMetalness: .22,
  faceContour: .10,
  antique: 1,
  studioStrength: 1,
  background: '#eedbdd',
};
