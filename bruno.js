const canvasSketch = require("canvas-sketch");
const { Pane } = require("tweakpane");

const settings = {
  dimensions: [1080, 1920],
  animate: true,
  pixelRatio: 1,
  fps: 30
};

let recording = false;
let frame = 0;

let video;
let videoReady = false;
let videoStatus = "loading";

const params = {
  bg: "#e9e6df",
  stroke: "#111111",

  showDebug: true,
  showFrame: true,

  strokeWidth: 1.5,
  arcStrokeWidth: 1.8,
  outerMargin: 72,

  sceneDuration: 2.6,
  sceneTransition: 1.25,

  posterScale: 0.94,
  posterOffsetY: 0,
  posterNoise: 0.0014,

  transitionFadePower: 1,

  rotateA: -0.012,
  rotateB: 0.01,
  rotateC: -0.008,
  rotateD: 0.006,
  rotateE: -0.005,

  transitionRotateAmount: 0.018,
  transitionScaleIn: 0.992,
  transitionScaleOut: 1.008,

  videoEnabled: true,
  videoAlpha: 1,
  videoScale: 1.02,
  videoOffsetX: 0,
  videoOffsetY: 0,
  videoPlaybackRate: 1,

  // tambahan supaya sambungan grid lebih rapat
  lineJoinOverlap: 1.0
};

const pane = new Pane();

pane.addInput(params, "showDebug", { label: "debug" });
pane.addInput(params, "showFrame", { label: "frame" });

pane.addInput(params, "sceneDuration", {
  min: 1,
  max: 8,
  step: 0.05,
  label: "scene dur"
});

pane.addInput(params, "sceneTransition", {
  min: 0.1,
  max: 3,
  step: 0.05,
  label: "scene trans"
});

pane.addInput(params, "strokeWidth", {
  min: 0.5,
  max: 4,
  step: 0.1,
  label: "stroke"
});

pane.addInput(params, "arcStrokeWidth", {
  min: 0.5,
  max: 4,
  step: 0.1,
  label: "arc"
});

pane.addInput(params, "posterScale", {
  min: 0.5,
  max: 1.2,
  step: 0.01,
  label: "scale"
});

pane.addInput(params, "transitionRotateAmount", {
  min: 0,
  max: 0.08,
  step: 0.001,
  label: "rot amt"
});

pane.addInput(params, "lineJoinOverlap", {
  min: 0,
  max: 3,
  step: 0.1,
  label: "join ov"
});

pane.addInput(params, "videoEnabled", { label: "video" });
pane.addInput(params, "videoAlpha", {
  min: 0,
  max: 1,
  step: 0.01,
  label: "vid alpha"
});
pane.addInput(params, "videoScale", {
  min: 0.5,
  max: 2,
  step: 0.01,
  label: "vid scale"
});
pane.addInput(params, "videoOffsetX", {
  min: -400,
  max: 400,
  step: 1,
  label: "vid off x"
});
pane.addInput(params, "videoOffsetY", {
  min: -400,
  max: 400,
  step: 1,
  label: "vid off y"
});

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();

  if (key === "r") {
    recording = true;
    frame = 0;
    console.log("RECORD START");
  }

  if (key === "s") {
    recording = false;
    console.log("RECORD STOP");
  }

  if (key === " ") {
    if (video && videoReady) {
      if (video.paused) video.play();
      else video.pause();
    }
  }
});

function setupVideo() {
  video = document.createElement("video");
  video.src = "video/yamal.mp4";
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.autoplay = true;
  videoPlaybackSafe(video);

  video.addEventListener("loadeddata", () => {
    videoReady = true;
    videoStatus = "ready";
    console.log("VIDEO READY");
  });

  video.addEventListener("canplay", () => {
    videoReady = true;
    videoStatus = "canplay";
    video.play().catch(() => {
      videoStatus = "paused by browser";
    });
  });

  video.addEventListener("error", () => {
    videoReady = false;
    videoStatus = "error";
    console.log("VIDEO ERROR");
  });
}

function videoPlaybackSafe(v) {
  try {
    v.playbackRate = params.videoPlaybackRate;
  } catch (e) {}
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mix(a, b, t) {
  return lerp(a, b, t);
}

function easeInOutQuart(t) {
  t = clamp(t, 0, 1);
  return t < 0.5
    ? 8 * t * t * t * t
    : 1 - Math.pow(-2 * t + 2, 4) / 2;
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255
  };
}

function rgba(hex, a = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function drawNoise(ctx, width, height, amount = 0.01) {
  if (amount <= 0) return;

  ctx.save();
  const count = Math.floor(width * height * amount * 0.08);

  for (let i = 0; i < count; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const a = Math.random() * 0.03;
    const g = Math.floor(Math.random() * 255);
    ctx.fillStyle = `rgba(${g},${g},${g},${a})`;
    ctx.fillRect(x, y, 1, 1);
  }

  ctx.restore();
}

function drawOuterFrame(ctx, width, height) {
  if (!params.showFrame) return;

  ctx.save();
  ctx.strokeStyle = rgba(params.stroke, 0.92);
  ctx.lineWidth = 2;
  ctx.strokeRect(32, 32, width - 64, height - 64);
  ctx.restore();
}

function drawPanel(ctx, x, y, w, h, fill, stroke = null, lineWidth = 1) {
  ctx.save();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(x, y, w, h);
  }
  ctx.restore();
}

function drawMicroText(ctx, text, x, y) {
  ctx.save();
  ctx.fillStyle = rgba(params.stroke, 0.9);
  ctx.font = "14px monospace";
  ctx.textBaseline = "top";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function getSceneCycleDuration() {
  return params.sceneDuration + params.sceneTransition;
}

function getSceneState(time) {
  const cycle = getSceneCycleDuration();
  const total = cycle * 5;
  const localTime = time % total;

  const sceneIndex = Math.floor(localTime / cycle);
  const sceneTime = localTime % cycle;

  return {
    sceneIndex,
    sceneTime,
    holdT: clamp(sceneTime / Math.max(0.0001, params.sceneDuration), 0, 1),
    transT: clamp(
      (sceneTime - params.sceneDuration) / Math.max(0.0001, params.sceneTransition),
      0,
      1
    )
  };
}

// =======================
// GRID / GUIDE HELPERS
// =======================

function snap(v) {
  return Math.round(v * 1000) / 1000;
}

function buildPosterRect(width, height, aspect = 0.62) {
  const maxW = width - params.outerMargin * 2;
  const maxH = height - params.outerMargin * 2;

  let w = maxW;
  let h = w / aspect;

  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }

  return {
    x: snap((width - w) * 0.5),
    y: snap((height - h) * 0.5),
    w: snap(w),
    h: snap(h)
  };
}

function createPosterGuides(poster) {
  return {
    x: (t) => snap(poster.x + poster.w * t),
    y: (t) => snap(poster.y + poster.h * t)
  };
}

function extendSegment(seg, amount = 0) {
  const [x1, y1, x2, y2] = seg;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;

  const ox = (dx / len) * amount;
  const oy = (dy / len) * amount;

  return [x1 - ox, y1 - oy, x2 + ox, y2 + oy];
}

function drawSegments(ctx, segs, overlap = 0) {
  ctx.beginPath();

  for (let i = 0; i < segs.length; i++) {
    const [x1, y1, x2, y2] = extendSegment(segs[i], overlap);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }

  ctx.stroke();
}

function drawArcs(ctx, arcs) {
  ctx.beginPath();

  for (let i = 0; i < arcs.length; i++) {
    const a = arcs[i];
    ctx.moveTo(
      a.cx + Math.cos(a.start) * a.r,
      a.cy + Math.sin(a.start) * a.r
    );
    ctx.arc(a.cx, a.cy, a.r, a.start, a.end, a.ccw || false);
  }

  ctx.stroke();
}

function drawPosterOutline(ctx, poster) {
  const g = createPosterGuides(poster);

  const outline = [
    [g.x(0), g.y(0), g.x(1), g.y(0)],
    [g.x(1), g.y(0), g.x(1), g.y(1)],
    [g.x(1), g.y(1), g.x(0), g.y(1)],
    [g.x(0), g.y(1), g.x(0), g.y(0)]
  ];

  const innerInsetX = 10 / poster.w;
  const innerInsetY = 10 / poster.h;

  const inner = [
    [g.x(innerInsetX), g.y(innerInsetY), g.x(1 - innerInsetX), g.y(innerInsetY)],
    [g.x(1 - innerInsetX), g.y(innerInsetY), g.x(1 - innerInsetX), g.y(1 - innerInsetY)],
    [g.x(1 - innerInsetX), g.y(1 - innerInsetY), g.x(innerInsetX), g.y(1 - innerInsetY)],
    [g.x(innerInsetX), g.y(1 - innerInsetY), g.x(innerInsetX), g.y(innerInsetY)]
  ];

  drawSegments(ctx, outline, params.lineJoinOverlap * 0.5);
  drawSegments(ctx, inner, params.lineJoinOverlap * 0.5);
}

function getSceneGeometry(index, poster) {
  const g = createPosterGuides(poster);

  if (index === 0) {
    return {
      segs: [
        [g.x(0.35), g.y(0.02), g.x(0.35), g.y(0.98)],
        [g.x(0.68), g.y(0.02), g.x(0.68), g.y(0.98)],
        [g.x(0.02), g.y(0.18), g.x(0.98), g.y(0.18)],
        [g.x(0.02), g.y(0.42), g.x(0.98), g.y(0.42)],
        [g.x(0.02), g.y(0.68), g.x(0.98), g.y(0.68)],
        [g.x(0.08), g.y(0.18), g.x(0.08), g.y(0.42)],
        [g.x(0.12), g.y(0.18), g.x(0.12), g.y(0.42)],
        [g.x(0.16), g.y(0.18), g.x(0.16), g.y(0.42)],
        [g.x(0.20), g.y(0.18), g.x(0.20), g.y(0.42)],
        [g.x(0.24), g.y(0.18), g.x(0.24), g.y(0.42)],
        [g.x(0.50), g.y(0.68), g.x(0.50), g.y(0.98)],
        [g.x(0.84), g.y(0.68), g.x(0.84), g.y(0.98)],
        [g.x(0.68), g.y(0.82), g.x(0.98), g.y(0.82)]
      ],
      arcs: [
        {
          cx: g.x(0.35),
          cy: g.y(0.68),
          r: snap(poster.w * 0.33),
          start: -Math.PI / 2,
          end: Math.PI / 2
        },
        {
          cx: g.x(0.35),
          cy: g.y(0.68),
          r: snap(poster.w * 0.17),
          start: -Math.PI / 2,
          end: Math.PI / 2
        },
        {
          cx: g.x(0.68),
          cy: g.y(0.68),
          r: snap(poster.w * 0.17),
          start: Math.PI / 2,
          end: -Math.PI / 2
        }
      ]
    };
  }

  if (index === 1) {
    return {
      segs: [
        [g.x(0.52), g.y(0.02), g.x(0.52), g.y(0.98)],
        [g.x(0.78), g.y(0.02), g.x(0.78), g.y(0.98)],
        [g.x(0.02), g.y(0.14), g.x(0.98), g.y(0.14)],
        [g.x(0.02), g.y(0.31), g.x(0.98), g.y(0.31)],
        [g.x(0.02), g.y(0.58), g.x(0.98), g.y(0.58)],
        [g.x(0.02), g.y(0.88), g.x(0.98), g.y(0.88)],
        [g.x(0.60), g.y(0.31), g.x(0.60), g.y(0.58)],
        [g.x(0.64), g.y(0.31), g.x(0.64), g.y(0.58)],
        [g.x(0.68), g.y(0.31), g.x(0.68), g.y(0.58)],
        [g.x(0.72), g.y(0.31), g.x(0.72), g.y(0.58)],
        [g.x(0.52), g.y(0.58), g.x(0.52), g.y(0.80)],
        [g.x(0.78), g.y(0.58), g.x(0.78), g.y(0.80)]
      ],
      arcs: [
        {
          cx: g.x(0.52),
          cy: g.y(0.31),
          r: snap(poster.w * 0.45),
          start: Math.PI,
          end: 0
        },
        {
          cx: g.x(0.52),
          cy: g.y(0.31),
          r: snap(poster.w * 0.19),
          start: Math.PI,
          end: 0
        },
        {
          cx: g.x(0.52),
          cy: g.y(0.58),
          r: snap(poster.w * 0.33),
          start: 0,
          end: Math.PI
        }
      ]
    };
  }

  if (index === 2) {
    return {
      segs: [
        [g.x(0.12), g.y(0.02), g.x(0.12), g.y(0.98)],
        [g.x(0.54), g.y(0.02), g.x(0.54), g.y(0.98)],
        [g.x(0.86), g.y(0.02), g.x(0.86), g.y(0.98)],
        [g.x(0.02), g.y(0.06), g.x(0.98), g.y(0.06)],
        [g.x(0.02), g.y(0.28), g.x(0.98), g.y(0.28)],
        [g.x(0.02), g.y(0.50), g.x(0.98), g.y(0.50)],
        [g.x(0.02), g.y(0.72), g.x(0.98), g.y(0.72)],
        [g.x(0.02), g.y(0.92), g.x(0.98), g.y(0.92)],
        [g.x(0.54), g.y(0.28), g.x(0.54), g.y(0.92)],
        [g.x(0.02), g.y(0.82), g.x(0.54), g.y(0.82)]
      ],
      arcs: [
        {
          cx: g.x(0.54),
          cy: g.y(0.28),
          r: snap(poster.w * 0.36),
          start: Math.PI,
          end: -Math.PI / 2
        },
        {
          cx: g.x(0.54),
          cy: g.y(0.28),
          r: snap(poster.w * 0.22),
          start: Math.PI,
          end: -Math.PI / 2
        },
        {
          cx: g.x(0.54),
          cy: g.y(0.28),
          r: snap(poster.w * 0.10),
          start: Math.PI,
          end: -Math.PI / 2
        }
      ]
    };
  }

  if (index === 3) {
    return {
      segs: [
        [g.x(0.48), g.y(0.02), g.x(0.48), g.y(0.98)],
        [g.x(0.74), g.y(0.02), g.x(0.74), g.y(0.44)],
        [g.x(0.02), g.y(0.24), g.x(0.98), g.y(0.24)],
        [g.x(0.02), g.y(0.52), g.x(0.98), g.y(0.52)],
        [g.x(0.02), g.y(0.78), g.x(0.98), g.y(0.78)],
        [g.x(0.08), g.y(0.02), g.x(0.08), g.y(0.24)],
        [g.x(0.12), g.y(0.02), g.x(0.12), g.y(0.24)],
        [g.x(0.16), g.y(0.02), g.x(0.16), g.y(0.24)],
        [g.x(0.20), g.y(0.02), g.x(0.20), g.y(0.24)],
        [g.x(0.24), g.y(0.02), g.x(0.24), g.y(0.24)],
        [g.x(0.28), g.y(0.02), g.x(0.28), g.y(0.24)],
        [g.x(0.08), g.y(0.52), g.x(0.08), g.y(0.78)],
        [g.x(0.12), g.y(0.52), g.x(0.12), g.y(0.78)],
        [g.x(0.16), g.y(0.52), g.x(0.16), g.y(0.78)],
        [g.x(0.20), g.y(0.52), g.x(0.20), g.y(0.78)],
        [g.x(0.24), g.y(0.52), g.x(0.24), g.y(0.78)],
        [g.x(0.28), g.y(0.52), g.x(0.28), g.y(0.78)],
        [g.x(0.74), g.y(0.62), g.x(0.98), g.y(0.62)],
        [g.x(0.74), g.y(0.70), g.x(0.98), g.y(0.70)]
      ],
      arcs: [
        {
          cx: g.x(0.48),
          cy: g.y(0.52),
          r: snap(poster.w * 0.32),
          start: Math.PI,
          end: -Math.PI / 2
        },
        {
          cx: g.x(0.48),
          cy: g.y(0.52),
          r: snap(poster.w * 0.13),
          start: Math.PI,
          end: -Math.PI / 2
        }
      ]
    };
  }

  return {
    segs: [
      [g.x(0.18), g.y(0.02), g.x(0.18), g.y(0.98)],
      [g.x(0.50), g.y(0.02), g.x(0.50), g.y(0.98)],
      [g.x(0.76), g.y(0.02), g.x(0.76), g.y(0.98)],
      [g.x(0.02), g.y(0.22), g.x(0.98), g.y(0.22)],
      [g.x(0.02), g.y(0.50), g.x(0.98), g.y(0.50)],
      [g.x(0.02), g.y(0.78), g.x(0.98), g.y(0.78)],
      [g.x(0.76), g.y(0.64), g.x(0.98), g.y(0.64)],
      [g.x(0.50), g.y(0.22), g.x(0.50), g.y(0.72)],
      [g.x(0.64), g.y(0.28), g.x(0.64), g.y(0.72)]
    ],
    arcs: [
      {
        cx: g.x(0.50),
        cy: g.y(0.22),
        r: snap(poster.w * 0.34),
        start: Math.PI,
        end: 0
      },
      {
        cx: g.x(0.50),
        cy: g.y(0.22),
        r: snap(poster.w * 0.24),
        start: Math.PI,
        end: 0
      },
      {
        cx: g.x(0.50),
        cy: g.y(0.22),
        r: snap(poster.w * 0.14),
        start: Math.PI,
        end: 0
      },
      {
        cx: g.x(0.50),
        cy: g.y(0.72),
        r: snap(poster.w * 0.22),
        start: 0,
        end: Math.PI
      },
      {
        cx: g.x(0.50),
        cy: g.y(0.72),
        r: snap(poster.w * 0.32),
        start: Math.PI,
        end: 0
      },
      {
        cx: g.x(0.50),
        cy: g.y(0.72),
        r: snap(poster.w * 0.27),
        start: Math.PI,
        end: 0
      },
      {
        cx: g.x(0.50),
        cy: g.y(0.72),
        r: snap(poster.w * 0.22),
        start: Math.PI,
        end: 0
      },
      {
        cx: g.x(0.50),
        cy: g.y(0.72),
        r: snap(poster.w * 0.17),
        start: Math.PI,
        end: 0
      }
    ]
  };
}

function getScene1VideoBoxes(poster) {
  const g = createPosterGuides(poster);

  return [
    {
      x: g.x(0.02),
      y: g.y(0.18),
      w: g.x(0.35) - g.x(0.02),
      h: g.y(0.42) - g.y(0.18)
    },
    {
      x: g.x(0.68),
      y: g.y(0.18),
      w: g.x(0.98) - g.x(0.68),
      h: g.y(0.42) - g.y(0.18)
    },
    {
      x: g.x(0.68),
      y: g.y(0.42),
      w: g.x(0.98) - g.x(0.68),
      h: g.y(0.68) - g.y(0.42)
    }
  ];
}

function drawVideoCover(ctx, vid, x, y, w, h, scale = 1, offsetX = 0, offsetY = 0) {
  if (!vid || !videoReady || vid.videoWidth <= 0 || vid.videoHeight <= 0) return;

  const boxRatio = w / h;
  const vidRatio = vid.videoWidth / vid.videoHeight;

  let sx = 0;
  let sy = 0;
  let sw = vid.videoWidth;
  let sh = vid.videoHeight;

  if (vidRatio > boxRatio) {
    sw = vid.videoHeight * boxRatio;
    sx = (vid.videoWidth - sw) * 0.5;
  } else {
    sh = vid.videoWidth / boxRatio;
    sy = (vid.videoHeight - sh) * 0.5;
  }

  const dw = w * scale;
  const dh = h * scale;
  const dx = x + (w - dw) * 0.5 + offsetX;
  const dy = y + (h - dh) * 0.5 + offsetY;

  ctx.drawImage(vid, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawScene1Video(ctx, poster, alpha = 1) {
  if (!params.videoEnabled || !videoReady) return;

  const boxes = getScene1VideoBoxes(poster);

  ctx.save();
  ctx.globalAlpha = alpha * params.videoAlpha;

  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];

    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();

    drawVideoCover(
      ctx,
      video,
      b.x,
      b.y,
      b.w,
      b.h,
      params.videoScale,
      params.videoOffsetX,
      params.videoOffsetY
    );

    ctx.restore();
  }

  ctx.restore();
}

function drawSceneGeometry(ctx, poster, index) {
  const geo = getSceneGeometry(index, poster);

  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  ctx.miterLimit = 10;

  ctx.lineWidth = params.strokeWidth;
  drawPosterOutline(ctx, poster);
  drawSegments(ctx, geo.segs, params.lineJoinOverlap);

  ctx.lineWidth = params.arcStrokeWidth;
  drawArcs(ctx, geo.arcs);
}

function getSceneRotation(index) {
  const rots = [
    params.rotateA,
    params.rotateB,
    params.rotateC,
    params.rotateD,
    params.rotateE
  ];
  return rots[index % rots.length];
}

function drawSceneInstance(ctx, width, height, poster, sceneIndex, alpha, rotation, scale = 1) {
  const cx = width * 0.5;
  const cy = height * 0.5 + params.posterOffsetY;

  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.translate(cx, cy);
  ctx.scale(params.posterScale * scale, params.posterScale * scale);
  ctx.rotate(rotation);
  ctx.translate(-cx, -cy);

  if (sceneIndex === 0) {
    drawScene1Video(ctx, poster, 1);
  }

  drawSceneGeometry(ctx, poster, sceneIndex);
  ctx.restore();
}

function drawSceneLabel(ctx, width, height, state) {
  ctx.save();
  ctx.fillStyle = rgba(params.stroke, 0.88);
  ctx.font = "12px monospace";
  ctx.textBaseline = "top";
  ctx.fillText(`scene ${state.sceneIndex + 1} / 5`, 46, height - 110);
  ctx.fillText("scene 1 contains clipped video", 46, height - 90);
  ctx.fillText("grid lines use shared guides", 46, height - 70);
  ctx.fillText("overlap extension removes visual gaps", 46, height - 50);
  ctx.restore();
}

const sketch = async () => {
  setupVideo();

  return ({ context, width, height, time }) => {
    context.fillStyle = params.bg;
    context.fillRect(0, 0, width, height);

    const state = getSceneState(time);
    const currentIndex = state.sceneIndex;
    const nextIndex = (state.sceneIndex + 1) % 5;
    const transEase = easeInOutQuart(state.transT);

    const poster = buildPosterRect(width, height, 0.62);

    context.strokeStyle = rgba(params.stroke, 0.96);
    context.lineCap = "butt";
    context.lineJoin = "miter";
    context.miterLimit = 10;

    if (video && video.playbackRate !== params.videoPlaybackRate) {
      video.playbackRate = params.videoPlaybackRate;
    }

    if (state.transT <= 0) {
      drawSceneInstance(
        context,
        width,
        height,
        poster,
        currentIndex,
        1,
        getSceneRotation(currentIndex),
        1
      );
    } else {
      const currentBaseRot = getSceneRotation(currentIndex);
      const nextBaseRot = getSceneRotation(nextIndex);

      const alphaOut = Math.pow(1 - transEase, params.transitionFadePower);
      const alphaIn = Math.pow(transEase, params.transitionFadePower);

      const rotOut = currentBaseRot - params.transitionRotateAmount * transEase;
      const rotIn = nextBaseRot + params.transitionRotateAmount * (1 - transEase);

      const scaleOut = mix(1, params.transitionScaleOut, transEase);
      const scaleIn = mix(params.transitionScaleIn, 1, transEase);

      drawSceneInstance(
        context,
        width,
        height,
        poster,
        currentIndex,
        alphaOut,
        rotOut,
        scaleOut
      );

      drawSceneInstance(
        context,
        width,
        height,
        poster,
        nextIndex,
        alphaIn,
        rotIn,
        scaleIn
      );
    }

    drawOuterFrame(context, width, height);
    drawSceneLabel(context, width, height, state);
    drawNoise(context, width, height, params.posterNoise);

    if (params.showDebug) {
      drawPanel(
        context,
        28,
        28,
        500,
        320,
        rgba("#ffffff", 0.9),
        rgba(params.stroke, 0.8),
        1
      );

      drawMicroText(context, `scene: ${state.sceneIndex + 1}/5`, 42, 42);
      drawMicroText(context, `sceneTime: ${state.sceneTime.toFixed(2)}`, 42, 64);
      drawMicroText(context, `holdT: ${state.holdT.toFixed(2)}`, 42, 86);
      drawMicroText(context, `transT: ${state.transT.toFixed(2)}`, 42, 108);
      drawMicroText(context, `rotation base: ${getSceneRotation(currentIndex).toFixed(4)}`, 42, 130);
      drawMicroText(context, `rot amount: ${params.transitionRotateAmount.toFixed(4)}`, 42, 152);
      drawMicroText(context, `join overlap: ${params.lineJoinOverlap.toFixed(2)}`, 42, 174);
      drawMicroText(context, `recording: ${recording}`, 42, 196);
      drawMicroText(context, `video: ${videoStatus}`, 42, 218);
      drawMicroText(context, `video ready: ${videoReady}`, 42, 240);
      drawMicroText(context, `scene1 video boxes: 3`, 42, 262);
      drawMicroText(context, `keys: R start / S stop / SPACE play-pause`, 42, 284);
    }

    if (recording) {
      const link = document.createElement("a");
      link.download = `frame_${String(frame).padStart(5, "0")}.png`;
      link.href = context.canvas.toDataURL("image/png");
      link.click();
      frame++;
    }
  };
};

canvasSketch(sketch, settings);