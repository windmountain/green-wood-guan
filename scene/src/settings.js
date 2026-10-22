// Every tweakable knob, with defaults. The GUI edits this object directly
// and it's saved to localStorage on change, so a reload keeps your look.

export const defaults = {
  // Playback (seconds)
  playing: true,
  time: 0,
  duration: 30,
  loop: true,
  routeStart: 2,
  walkerSpeed: 1, // route miles per second of video (~40 mi total)
  walkerOffset: 0, // miles along the route the walker starts from

  // Camera
  freeCamera: false,
  fov: 35,
  distance: 14000,
  elevationAngle: 38,
  azimuthStart: 200,
  orbitDegrees: 90,
  targetHeight: 0,
  followWalker: 0,

  // Terrain
  terrainStyle: 'ridgelines',
  terrainRadius: 7000,
  cellSize: 40,
  maxGap: 250,
  idwPower: 2,
  smoothing: 3,
  exaggeration: 5,
  clipToBoundary: false,
  clipMargin: 150,
  lineEvery: 2,
  ridgeAxis: 'x',
  contourInterval: 10,
  occlude: true,
  terrainWidth: 1.5,
  terrainOpacity: 0.7,
  // One hue; saturation/lightness (0–1) at the lowest and highest ground.
  terrainHue: 205,
  lowSaturation: 0.52,
  lowLightness: 0.24,
  highSaturation: 1,
  highLightness: 0.75,
  pointSize: 3,
  edgeFade: 0.4,

  // Paths (the whole network)
  showPaths: true,
  pathWidth: 2,
  pathOpacity: 0.35,
  pathColor: '#ffffff',
  pathLift: 4,

  // Route (Guan route, drawn over time)
  showRoute: true,
  routeWidth: 3,
  routeOpacity: 1,
  routeColor: '#ffb347',
  retraceColor: '#ff4f6d',
  routeLift: 8,
  showWalker: true,
  walkerSize: 30,
  walkerColor: '#ffffff',

  // Look
  background: '#000000',
  fog: true,
  fogNear: 9000,
  fogFar: 24000,
  bloom: true,
  bloomStrength: 0.9,
  bloomRadius: 0.5,
  bloomThreshold: 0.1,

  // Recording
  recordFps: 60,
  recordMbps: 40,
};

const KEY = 'green-wood-scene-settings';

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...defaults, ...saved, time: 0 };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // private window etc. — settings just won't persist
  }
}

export function clearSettings() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
