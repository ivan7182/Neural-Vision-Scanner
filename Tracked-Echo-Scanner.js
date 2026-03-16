const canvasSketch = require("canvas-sketch");
const Tweakpane = require("tweakpane");

// ================= SETTINGS =================
const settings = {
  dimensions: [540, 960],
  animate: true,
  pixelRatio: 1,
};

// ================= GLOBALS =================
let video;
let audio, audioCtx, analyser, dataArray;
let previousFrame = null;
let frameBufferCanvas, frameBufferCtx;

let boxEffectMemory = new Map();
let blobNodeMemory = new Map();

let globalVisualState = {
  mode: "scan",
  holdUntil: 0
};

let cropBgState = {
  mode: "blue",
  holdUntil: 0
};

// ================= PARAMS =================
const params = {
  threshold: 46,
  outline: 2,
  bassThreshold: 135,
  sensitivity: 1.15,

  blobTracking: true,
  minBlobSize: 90,
  maxBoxes: 6,

  dataHud: true,
  outerHud: true,
  hudScale: 1,
  hudStrong: true,

  boxEffects: true,
  effectMinDuration: 110,
  effectMaxDuration: 240,

  globalModeMinDuration: 180,
  globalModeMaxDuration: 340,

  glitch: true,
  glitchChance: 0.003,
  noiseInsideBox: true,
  radarPulse: true,
  boxFlicker: true,
  digitOverlay: true,
  vignette: true,
  networkMode: true,

  thermal: true,
  thermalMix: 0.28,
  thermalBeatBoost: 0.22,
  thermalInsideBoxes: true,
  ascii: false,

  isolateToTrackedBoxes: true,
  cropPadding: 18,
  cropBgAlpha: 0.98,
  cropOnlyLargest: false,

  outsideObjectAscii: true,
  outsideAsciiStep: 4,
  outsideAsciiAlpha: 1,
  outsideAsciiShadow: true,
};

let motionThreshold = params.threshold;
let outlineWidth = params.outline;

const asciiChars = [" ", "。", "、", "ヲ", "ツ", "ロ", "日", "国", "語", "愛", "龍"];
const digits = "0123456789ABCDEF";

// ================= TWEAKPANE =================
const pane = new Tweakpane.Pane();

pane.addInput(params, "threshold", { min: 10, max: 200, step: 1 })
  .on("change", (v) => motionThreshold = v.value);

pane.addInput(params, "bassThreshold", { min: 50, max: 255, step: 1 });
pane.addInput(params, "minBlobSize", { min: 10, max: 500, step: 1 });
pane.addInput(params, "dataHud");
pane.addInput(params, "outerHud");
pane.addInput(params, "boxEffects");
pane.addInput(params, "thermal");
pane.addInput(params, "thermalMix", { min: 0, max: 1, step: 0.01 });
pane.addInput(params, "thermalBeatBoost", { min: 0, max: 1, step: 0.01 });
pane.addInput(params, "thermalInsideBoxes");

pane.addInput(params, "isolateToTrackedBoxes");
pane.addInput(params, "cropPadding", { min: 0, max: 80, step: 1 });
pane.addInput(params, "cropBgAlpha", { min: 0, max: 1, step: 0.01 });
pane.addInput(params, "cropOnlyLargest");

pane.addInput(params, "outsideObjectAscii");
pane.addInput(params, "outsideAsciiStep", { min: 4, max: 14, step: 1 });
pane.addInput(params, "outsideAsciiAlpha", { min: 0.1, max: 1, step: 0.01 });

// ================= HELPERS =================
function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function expandBlob(blob, padding, width, height) {
  const x = Math.max(0, Math.floor(blob.x - padding));
  const y = Math.max(0, Math.floor(blob.y - padding));
  const right = Math.min(width, Math.ceil(blob.x + blob.w + padding));
  const bottom = Math.min(height, Math.ceil(blob.y + blob.h + padding));

  return {
    x,
    y,
    w: Math.max(1, right - x),
    h: Math.max(1, bottom - y),
    area: blob.area
  };
}

function updateCropBgState(frameCount) {
  const modes = ["blue", "white", "black"];

  if (frameCount >= cropBgState.holdUntil) {
    let next = pick(modes);

    while (next === cropBgState.mode && modes.length > 1) {
      next = pick(modes);
    }

    cropBgState.mode = next;
    cropBgState.holdUntil = frameCount + Math.floor(rand(40, 110));
  }

  return cropBgState.mode;
}

function getCropBgFill() {
  if (cropBgState.mode === "blue") {
    return `rgba(20, 80, 255, ${params.cropBgAlpha})`;
  }
  if (cropBgState.mode === "white") {
    return `rgba(255, 255, 255, ${params.cropBgAlpha})`;
  }
  return `rgba(0, 0, 0, ${params.cropBgAlpha})`;
}

function getThermalColor(v) {
  let r = 0, g = 0, b = 0;

  if (v < 0.2) {
    r = 0;
    g = 40 + v * 2.5 * 255;
    b = 255;
  } else if (v < 0.4) {
    r = 0;
    g = 180 + (v - 0.2) * 2 * 75;
    b = 255 - (v - 0.2) * 5 * 120;
  } else if (v < 0.6) {
    r = (v - 0.4) * 5 * 180;
    g = 255;
    b = 80 - (v - 0.4) * 5 * 80;
  } else if (v < 0.8) {
    r = 180 + (v - 0.6) * 5 * 75;
    g = 255 - (v - 0.6) * 5 * 120;
    b = 0;
  } else {
    r = 255;
    g = 135 - (v - 0.8) * 5 * 135;
    b = 0;
  }

  return `rgb(${Math.round(clamp(r, 0, 255))},${Math.round(clamp(g, 0, 255))},${Math.round(clamp(b, 0, 255))})`;
}

function getBassEnergy(dataArray) {
  let sum = 0;
  const bassBins = 8;
  for (let i = 0; i < bassBins; i++) sum += dataArray[i];
  return sum / bassBins;
}

function drawVignette(ctx, width, height) {
  const grad = ctx.createRadialGradient(
    width / 2, height / 2, width * 0.15,
    width / 2, height / 2, width * 0.9
  );
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.58)");

  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function findEdges(mask, width, height) {
  const edges = [];

  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const idx = y * width + x;

      if (mask[idx] === 1) {
        const n = [
          mask[(y - 1) * width + x],
          mask[(y + 1) * width + x],
          mask[y * width + (x - 1)],
          mask[y * width + (x + 1)]
        ];

        if (n.some(v => v === 0)) edges.push({ x, y });
      }
    }
  }

  return edges;
}

function drawEdges(ctx, edgePixels, widthOverride = 2) {
  ctx.save();
  ctx.strokeStyle = "rgba(120,255,120,0.6)";
  ctx.lineWidth = widthOverride;
  ctx.beginPath();

  for (const p of edgePixels) {
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 1, p.y);
  }

  ctx.stroke();
  ctx.restore();
}

function pointInBlobBounds(x, y, blob) {
  return x >= blob.x && x < blob.x + blob.w && y >= blob.y && y < blob.y + blob.h;
}

function pointInExpandedBlob(x, y, blob, width, height) {
  const box = expandBlob(blob, params.cropPadding, width, height);
  return x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
}

function getMaskDensity(mask, x, y, width, height, radius = 4) {
  let hit = 0;
  let total = 0;

  for (let oy = -radius; oy <= radius; oy++) {
    for (let ox = -radius; ox <= radius; ox++) {
      const nx = x + ox;
      const ny = y + oy;

      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      total++;

      if (mask[ny * width + nx] === 1) hit++;
    }
  }

  return total > 0 ? hit / total : 0;
}

// ================= DRAW ONLY TRACKED BOX AREAS =================
function drawIsolatedTrackedBoxes(ctx, sourceCanvas, blobs, width, height) {
  ctx.save();

  ctx.fillStyle = getCropBgFill();
  ctx.fillRect(0, 0, width, height);

  const list = params.cropOnlyLargest && blobs.length ? [blobs[0]] : blobs;

  list.forEach((blob, i) => {
    const box = expandBlob(blob, params.cropPadding, width, height);

    ctx.drawImage(
      sourceCanvas,
      box.x, box.y, box.w, box.h,
      box.x, box.y, box.w, box.h
    );

    ctx.save();
    ctx.strokeStyle = i === 0
      ? "rgba(255,80,80,0.95)"
      : "rgba(255,110,110,0.82)";
    ctx.lineWidth = 2;
    ctx.strokeRect(box.x, box.y, box.w, box.h);

    const c = 12;
    ctx.beginPath();
    ctx.moveTo(box.x, box.y + c); ctx.lineTo(box.x, box.y); ctx.lineTo(box.x + c, box.y);
    ctx.moveTo(box.x + box.w - c, box.y); ctx.lineTo(box.x + box.w, box.y); ctx.lineTo(box.x + box.w, box.y + c);
    ctx.moveTo(box.x, box.y + box.h - c); ctx.lineTo(box.x, box.y + box.h); ctx.lineTo(box.x + c, box.y + box.h);
    ctx.moveTo(box.x + box.w - c, box.y + box.h); ctx.lineTo(box.x + box.w, box.y + box.h); ctx.lineTo(box.x + box.w, box.y + box.h - c);
    ctx.stroke();

    ctx.restore();
  });

  ctx.restore();
}

// ================= ASCII OUTSIDE BOX ONLY =================
function drawAsciiObjectOutsideBoxes(ctx, motionMask, pixels, blobs, width, height, bass, frameCount) {
  if (!params.outsideObjectAscii) return;
  if (!blobs.length) return;

  const activeBlobs = params.cropOnlyLargest ? [blobs[0]] : blobs;
  const step = params.outsideAsciiStep;
  const beatBoost = bass > params.bassThreshold ? 0.12 : 0;

  ctx.save();
  ctx.font = `bold ${Math.max(12, step + 6)}px monospace`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const density = getMaskDensity(motionMask, x, y, width, height, 4);
      if (density < 0.08) continue;

      let insideAnyBox = false;
      for (const blob of activeBlobs) {
        if (pointInExpandedBlob(x, y, blob, width, height)) {
          insideAnyBox = true;
          break;
        }
      }
      if (insideAnyBox) continue;

      const idx = y * width + x;
      const pi = idx * 4;

      const r = pixels[pi];
      const g = pixels[pi + 1];
      const b = pixels[pi + 2];
      const brightness = (r + g + b) / 3 / 255;

      const value = clamp(brightness * 0.3 + density * 1.2, 0, 1);
      const charIdx = Math.floor(value * (asciiChars.length - 1));
      const char = asciiChars[charIdx];
      if (char === " ") continue;

      let fillColor = `rgba(255,255,255,${clamp(0.82 + density * 0.28 + beatBoost, 0, 1)})`;

      if (cropBgState.mode === "white") {
        fillColor = `rgba(0,0,0,${clamp(0.88 + density * 0.2 + beatBoost, 0, 1)})`;
      } else if (cropBgState.mode === "black") {
        fillColor = `rgba(255,255,255,${clamp(0.88 + density * 0.2 + beatBoost, 0, 1)})`;
      } else if (cropBgState.mode === "blue") {
        fillColor = `rgba(255,255,255,${clamp(0.92 + density * 0.18 + beatBoost, 0, 1)})`;
      }

      if (params.outsideAsciiShadow) {
        ctx.fillStyle = cropBgState.mode === "white"
          ? "rgba(255,255,255,0.18)"
          : "rgba(0,0,0,0.42)";
        ctx.fillText(char, x + 1, y + 1);
        ctx.fillText(char, x + 2, y + 2);
      }

      ctx.fillStyle = fillColor;
      ctx.fillText(char, x, y);
      ctx.fillText(char, x + 0.4, y);
    }
  }

  ctx.restore();
}

// ================= BLOB TRACKING =================
function findBlobs(mask, width, height, minBlobSize = 80, maxBoxes = 8) {
  const visited = new Uint8Array(width * height);
  const blobs = [];
  const dirs = [[2, 0], [-2, 0], [0, 2], [0, -2]];

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const startIdx = y * width + x;
      if (mask[startIdx] !== 1 || visited[startIdx]) continue;

      const queue = [{ x, y }];
      visited[startIdx] = 1;

      let count = 0;
      let minX = x, minY = y, maxX = x, maxY = y;

      while (queue.length > 0) {
        const p = queue.pop();
        count++;

        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;

        for (const [dx, dy] of dirs) {
          const nx = p.x + dx;
          const ny = p.y + dy;

          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

          const ni = ny * width + nx;
          if (mask[ni] === 1 && !visited[ni]) {
            visited[ni] = 1;
            queue.push({ x: nx, y: ny });
          }
        }
      }

      if (count >= minBlobSize) {
        blobs.push({
          x: minX,
          y: minY,
          w: maxX - minX + 2,
          h: maxY - minY + 2,
          area: count
        });
      }
    }
  }

  blobs.sort((a, b) => b.area - a.area);
  return blobs.slice(0, maxBoxes);
}

// ================= VISUAL STATE =================
function getBlobKey(blob) {
  const kx = Math.floor(blob.x / 28);
  const ky = Math.floor(blob.y / 28);
  const kw = Math.floor(blob.w / 28);
  const kh = Math.floor(blob.h / 28);
  return `${kx}_${ky}_${kw}_${kh}`;
}

function updateGlobalVisualState(frameCount) {
  const modes = ["scan", "network", "minimal", "digits"];

  if (frameCount >= globalVisualState.holdUntil) {
    let next = pick(modes);

    while (next === globalVisualState.mode && modes.length > 1) {
      next = pick(modes);
    }

    globalVisualState.mode = next;
    globalVisualState.holdUntil =
      frameCount + Math.floor(rand(params.globalModeMinDuration, params.globalModeMaxDuration));
  }

  return globalVisualState.mode;
}

function getRandomBoxEffect(blob, frameCount) {
  const key = getBlobKey(blob);
  const options = ["scan", "digits", "wire", "dots", "ascii", "thermal"];

  if (!boxEffectMemory.has(key)) {
    const effect = pick(options);
    boxEffectMemory.set(key, {
      effect,
      holdUntil: frameCount + Math.floor(rand(params.effectMinDuration, params.effectMaxDuration))
    });
  }

  const item = boxEffectMemory.get(key);

  if (frameCount >= item.holdUntil) {
    let newEffect = pick(options);

    while (newEffect === item.effect && options.length > 1) {
      newEffect = pick(options);
    }

    item.effect = newEffect;
    item.holdUntil = frameCount + Math.floor(rand(params.effectMinDuration, params.effectMaxDuration));
  }

  return item.effect;
}

// ================= NETWORK MODE =================
function getBlobEdgePoints(blob, mask, width, height, maxPoints = 18) {
  const pts = [];

  for (let y = Math.max(2, blob.y); y < Math.min(height - 2, blob.y + blob.h); y += 4) {
    for (let x = Math.max(2, blob.x); x < Math.min(width - 2, blob.x + blob.w); x += 4) {
      if (!pointInBlobBounds(x, y, blob)) continue;

      const idx = y * width + x;
      if (mask[idx] !== 1) continue;

      const up = mask[(y - 2) * width + x] || 0;
      const down = mask[(y + 2) * width + x] || 0;
      const left = mask[y * width + (x - 2)] || 0;
      const right = mask[y * width + (x + 2)] || 0;

      if (up === 0 || down === 0 || left === 0 || right === 0) {
        pts.push({ x, y });
      }
    }
  }

  if (pts.length <= maxPoints) return pts;

  const step = pts.length / maxPoints;
  const sampled = [];
  for (let i = 0; i < maxPoints; i++) {
    sampled.push(pts[Math.floor(i * step)]);
  }
  return sampled;
}

function getBlobNodes(blob, frameCount, mask, width, height) {
  const key = getBlobKey(blob);
  const edgePoints = getBlobEdgePoints(blob, mask, width, height, 16);

  if (!blobNodeMemory.has(key)) {
    const nodes = edgePoints.length > 0
      ? edgePoints.map((p, i) => ({
          x: p.x,
          y: p.y,
          label: `endcore ${i + 1}`
        }))
      : [];

    blobNodeMemory.set(key, {
      nodes,
      holdUntil: frameCount + Math.floor(rand(120, 260))
    });
  }

  const item = blobNodeMemory.get(key);

  if (frameCount >= item.holdUntil) {
    const refreshed = edgePoints.length > 0
      ? edgePoints.map((p, i) => ({
          x: p.x + rand(-2, 2),
          y: p.y + rand(-2, 2),
          label: `endcore ${i + 1}`
        }))
      : [];

    item.nodes = refreshed;
    item.holdUntil = frameCount + Math.floor(rand(120, 260));
  } else {
    item.nodes.forEach((n) => {
      n.x += rand(-0.15, 0.15);
      n.y += rand(-0.15, 0.15);
      n.x = clamp(n.x, blob.x, blob.x + blob.w);
      n.y = clamp(n.y, blob.y, blob.y + blob.h);
    });
  }

  return item.nodes;
}

function drawBlobNetwork(ctx, blob, frameCount, mask, width, height) {
  const nodes = getBlobNodes(blob, frameCount, mask, width, height);
  if (!nodes.length) return;

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];

    const nearest = [...nodes]
      .filter((_, j) => j !== i)
      .map((b) => ({
        node: b,
        d: Math.hypot(a.x - b.x, a.y - b.y)
      }))
      .sort((p, q) => p.d - q.d)
      .slice(0, 2);

    nearest.forEach(({ node, d }, idx) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(node.x, node.y);
      ctx.strokeStyle = idx === 0
        ? "rgba(255,70,70,0.78)"
        : "rgba(235,245,255,0.34)";
      ctx.lineWidth = d < 60 ? 1 : 0.7;
      ctx.stroke();
    });
  }

  nodes.forEach((n, i) => {
    ctx.beginPath();
    ctx.arc(n.x, n.y, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = i % 4 === 0
      ? "rgba(255,90,90,0.95)"
      : "rgba(210,240,255,0.92)";
    ctx.fill();

    if (i % 3 === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.font = "7px monospace";
      ctx.fillText(n.label, n.x + 4, n.y - 4);
    }
  });
}

// ================= OUTER HUD =================
function drawCrosshair(ctx, cx, cy, size = 14) {
  ctx.save();
  ctx.strokeStyle = "rgba(0,255,120,0.92)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(cx - size, cy);
  ctx.lineTo(cx - 4, cy);
  ctx.moveTo(cx + 4, cy);
  ctx.lineTo(cx + size, cy);
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx, cy - 4);
  ctx.moveTo(cx, cy + 4);
  ctx.lineTo(cx, cy + size);
  ctx.stroke();
  ctx.restore();
}

function drawOuterTargetHUD(ctx, blob, i, bass, frame) {
  if (!params.outerHud) return;

  const cx = blob.x + blob.w / 2;
  const cy = blob.y + blob.h / 2;
  const ringR = Math.max(blob.w, blob.h) * 0.36 + 10;
  const ringR2 = ringR + 10 + Math.sin(frame * 0.08 + i) * 2;

  ctx.save();

  ctx.strokeStyle = "rgba(255,70,70,0.85)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, 0, Math.PI * 1.45);
  ctx.stroke();

  ctx.strokeStyle = "rgba(0,255,120,0.55)";
  ctx.beginPath();
  ctx.arc(cx, cy, ringR2, Math.PI * 0.2, Math.PI * 1.8);
  ctx.stroke();

  drawCrosshair(ctx, cx, cy, 15);

  const side = cx < ctx.canvas.width * 0.5 ? 1 : -1;
  const panelW = 150;
  const panelH = 56;

  let panelX = side > 0 ? cx + ringR + 18 : cx - ringR - panelW - 18;
  let panelY = cy - panelH * 0.5;

  panelX = clamp(panelX, 8, ctx.canvas.width - panelW - 8);
  panelY = clamp(panelY, 8, ctx.canvas.height - panelH - 8);

  const anchorX = side > 0 ? panelX : panelX + panelW;
  const anchorY = panelY + 16;

  ctx.beginPath();
  ctx.moveTo(cx + side * ringR * 0.8, cy - 3);
  ctx.lineTo(anchorX, anchorY);
  ctx.strokeStyle = "rgba(0,255,120,0.85)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.fillStyle = "rgba(0,0,0,0.58)";
  ctx.fillRect(panelX, panelY, panelW, panelH);

  ctx.strokeStyle = "rgba(0,255,120,0.88)";
  ctx.lineWidth = 1;
  ctx.strokeRect(panelX, panelY, panelW, panelH);

  ctx.fillStyle = "rgba(0,255,120,0.98)";
  ctx.font = "10px monospace";
  ctx.fillText(`TARGET_${String(i + 1).padStart(2, "0")}`, panelX + 8, panelY + 13);

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "9px monospace";
  ctx.fillText(`POS:${Math.round(cx)},${Math.round(cy)}`, panelX + 8, panelY + 27);
  ctx.fillText(`SIZE:${Math.round(blob.w)}x${Math.round(blob.h)}`, panelX + 8, panelY + 39);
  ctx.fillText(`BASS:${Math.round(bass)}  A:${blob.area}`, panelX + 8, panelY + 51);

  ctx.restore();
}

// ================= HUD =================
function drawDataHUD(ctx, blob, i, bass, frame) {
  if (!params.dataHud) return;

  const { x, y, w, h, area } = blob;
  const flicker = params.boxFlicker ? 0.94 + Math.random() * 0.06 : 1;

  ctx.save();
  ctx.globalAlpha = flicker;

  ctx.strokeStyle = "rgba(255,70,70,0.98)";
  ctx.lineWidth = 1.4;
  ctx.strokeRect(x, y, w, h);

  const c = 10;
  ctx.beginPath();
  ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
  ctx.moveTo(x + w - c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + c);
  ctx.moveTo(x, y + h - c); ctx.lineTo(x, y + h); ctx.lineTo(x + c, y + h);
  ctx.moveTo(x + w - c, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - c);
  ctx.stroke();

  const cx = x + w / 2;
  const cy = y + h / 2;

  drawCrosshair(ctx, cx, cy, 12);

  const scanY = y + ((frame * 3) % Math.max(h, 1));
  ctx.beginPath();
  ctx.moveTo(x, scanY);
  ctx.lineTo(x + w, scanY);
  ctx.strokeStyle = "rgba(0,255,120,0.28)";
  ctx.stroke();

  if (params.radarPulse) {
    const pulseR = 8 + Math.sin(frame * 0.12 + i) * 3;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(3, pulseR), 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,70,70,0.34)";
    ctx.stroke();
  }

  if (!params.outerHud) {
    const panelW = 128;
    const panelH = 42;
    let labelX = x + w + 12;
    let labelY = y - 8 < 10 ? y + 14 : y - 8;

    if (labelX + panelW > ctx.canvas.width - 4) {
      labelX = Math.max(4, x - panelW - 12);
    }

    ctx.beginPath();
    ctx.moveTo(x + w, y + h * 0.25);
    ctx.lineTo(labelX - 6 + (labelX > x ? 0 : panelW), labelY - 4);
    ctx.strokeStyle = "rgba(0,255,120,0.82)";
    ctx.stroke();

    ctx.fillStyle = "rgba(0,0,0,0.56)";
    ctx.fillRect(labelX, labelY - 12, panelW, panelH);
    ctx.strokeStyle = "rgba(0,255,120,0.86)";
    ctx.strokeRect(labelX, labelY - 12, panelW, panelH);

    ctx.fillStyle = "rgba(0,255,120,0.98)";
    ctx.font = "9px monospace";
    ctx.fillText(`OBJ_${String(i + 1).padStart(2, "0")}`, labelX + 6, labelY);
    ctx.fillText(`SIZE:${Math.round(w)}x${Math.round(h)}`, labelX + 6, labelY + 11);
    ctx.fillText(`AREA:${area}`, labelX + 6, labelY + 22);
    ctx.fillText(`BASS:${Math.round(bass)}`, labelX + 66, labelY + 22);
  }

  ctx.restore();
}

function drawBoxTag(ctx, blob, label = "RE-HOGRAMMING") {
  const tx = blob.x;
  const ty = Math.max(6, blob.y - 14);

  ctx.save();
  ctx.fillStyle = "rgba(20,0,0,0.82)";
  ctx.fillRect(tx, ty, 92, 11);

  ctx.strokeStyle = "rgba(255,60,60,0.94)";
  ctx.strokeRect(tx, ty, 92, 11);

  ctx.fillStyle = "rgba(120,255,120,0.96)";
  ctx.font = "8px monospace";
  ctx.fillText(label, tx + 4, ty + 8);
  ctx.restore();
}

// ================= BOX FX =================
function renderNoiseInsideBox(ctx, blob) {
  if (!params.noiseInsideBox) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(blob.x, blob.y, blob.w, blob.h);
  ctx.clip();

  const amount = Math.floor(blob.w * blob.h * 0.002);
  for (let i = 0; i < amount; i++) {
    const nx = blob.x + Math.random() * blob.w;
    const ny = blob.y + Math.random() * blob.h;
    const a = Math.random() * 0.08;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(nx, ny, 1, 1);
  }

  ctx.restore();
}

function renderThermalInsideBox(ctx, blob, pixels, width, height, frameCount, thermalAlpha = 0.6, motionMask = null) {
  const startX = Math.max(0, blob.x);
  const startY = Math.max(0, blob.y);
  const endX = Math.min(width, blob.x + blob.w);
  const endY = Math.min(height, blob.y + blob.h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(blob.x, blob.y, blob.w, blob.h);
  ctx.clip();

  for (let y = startY; y < endY; y += 4) {
    for (let x = startX; x < endX; x += 4) {
      const mIdx = y * width + x;
      if (motionMask && motionMask[mIdx] !== 1) continue;

      const idx = (y * width + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const brightness = (r + g + b) / 3 / 255;

      ctx.fillStyle = getThermalColor(brightness);
      ctx.globalAlpha = thermalAlpha * (0.45 + brightness * 0.75);
      ctx.fillRect(x, y, 4, 4);
    }
  }

  const scanY = startY + ((frameCount * 4) % Math.max(1, blob.h));
  ctx.globalAlpha = 0.2 + thermalAlpha * 0.2;
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.fillRect(startX, scanY, blob.w, 4);

  ctx.restore();
}

function drawThermalOnTrackedObjects(ctx, blobs, motionMask, pixels, width, height, frameCount, intensity, isBeat) {
  if (!params.thermal || !blobs.length) return;

  const thermalAlpha = clamp(
    params.thermalMix * 0.65 + intensity * (params.thermalBeatBoost * 0.55) + (isBeat ? 0.08 : 0),
    0,
    0.65
  );

  blobs.forEach((blob) => {
    renderThermalInsideBox(
      ctx,
      blob,
      pixels,
      width,
      height,
      frameCount,
      thermalAlpha,
      motionMask
    );
  });
}

function renderEffectInsideBox(ctx, blob, pixels, width, height, frameCount, sceneMode, thermalAlpha = 0.4, motionMask = null) {
  let effect = getRandomBoxEffect(blob, frameCount);

  if (sceneMode === "network") effect = "wire";
  if (sceneMode === "digits") effect = "digits";
  if (sceneMode === "scan") effect = "scan";
  if (sceneMode === "minimal") effect = Math.random() < 0.25 ? "dots" : "ascii";

  const startX = Math.max(0, blob.x);
  const startY = Math.max(0, blob.y);
  const endX = Math.min(width, blob.x + blob.w);
  const endY = Math.min(height, blob.y + blob.h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(blob.x, blob.y, blob.w, blob.h);
  ctx.clip();

  ctx.fillStyle = effect === "ascii"
    ? "rgba(0,0,0,0.05)"
    : "rgba(0,0,0,0.08)";
  ctx.fillRect(blob.x, blob.y, blob.w, blob.h);

  if (effect === "ascii") {
    const step = 5;
    ctx.font = "10px monospace";
    ctx.textBaseline = "top";

    for (let y = startY; y < endY; y += step) {
      for (let x = startX; x < endX; x += step) {
        const idx = (y * width + x) * 4;

        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];

        const brightness = (r + g + b) / 3 / 255;
        const charIdx = Math.floor(brightness * (asciiChars.length - 1));
        const char = asciiChars[charIdx];

        if (char === " " && brightness < 0.12) continue;

        ctx.fillStyle = "rgba(0,0,0,0.16)";
        ctx.fillText(char, x + 1, y + 1);

        ctx.fillStyle = `rgba(${r},${g},${b},0.98)`;
        ctx.fillText(char, x, y);
      }
    }
  } else if (effect === "scan") {
    for (let y = startY; y < endY; y += 4) {
      for (let x = startX; x < endX; x += 4) {
        const idx = (y * width + x) * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];

        ctx.fillStyle = `rgba(${r},${g},${b},0.18)`;
        ctx.fillRect(x, y, 2, 2);
      }
    }

    const scanY = startY + ((frameCount * 3) % Math.max(1, blob.h));
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(startX, scanY, blob.w, 4);

    ctx.strokeStyle = "rgba(255,80,80,0.34)";
    ctx.beginPath();
    ctx.moveTo(startX, scanY + 2);
    ctx.lineTo(startX + blob.w, scanY + 2);
    ctx.stroke();
  } else if (effect === "dots") {
    for (let y = startY; y < endY; y += 6) {
      for (let x = startX; x < endX; x += 6) {
        const idx = (y * width + x) * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];
        const brightness = (r + g + b) / 3 / 255;
        const size = 0.6 + brightness * 2.2;

        ctx.fillStyle = `rgba(${r},${g},${b},0.72)`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (effect === "digits") {
    ctx.font = "8px monospace";
    ctx.textBaseline = "top";

    for (let y = startY; y < endY; y += 9) {
      for (let x = startX; x < endX; x += 9) {
        const idx = (y * width + x) * 4;
        const brightness = (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3 / 255;
        const char = digits[Math.floor(brightness * (digits.length - 1))];

        ctx.fillStyle = `rgba(0,255,120,${0.16 + brightness * 0.36})`;
        ctx.fillText(char, x, y);
      }
    }
  } else if (effect === "wire") {
    ctx.strokeStyle = "rgba(255,120,120,0.28)";

    for (let y = startY; y < endY; y += 10) {
      ctx.beginPath();

      for (let x = startX; x < endX; x += 8) {
        const idx = (y * width + x) * 4;
        const brightness = (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3 / 255;
        const offset = (brightness - 0.5) * 8;

        if (x === startX) ctx.moveTo(x, y + offset);
        else ctx.lineTo(x, y + offset);
      }

      ctx.stroke();
    }
  } else if (effect === "thermal") {
    renderThermalInsideBox(ctx, blob, pixels, width, height, frameCount, thermalAlpha, motionMask);
  }

  if (params.thermal && params.thermalInsideBoxes && effect !== "thermal") {
    renderThermalInsideBox(ctx, blob, pixels, width, height, frameCount, thermalAlpha * 0.55, motionMask);
  }

  if (params.digitOverlay && effect !== "ascii" && Math.random() < 0.2) {
    ctx.font = "7px monospace";
    ctx.textBaseline = "top";

    for (let i = 0; i < Math.max(3, Math.floor(blob.area / 150)); i++) {
      const x = rand(blob.x + 4, blob.x + Math.max(5, blob.w - 4));
      const y = rand(blob.y + 8, blob.y + Math.max(9, blob.h - 4));
      ctx.fillStyle = `rgba(0,255,120,${rand(0.1, 0.22)})`;
      ctx.fillText(pick(digits), x, y);
    }
  }

  renderNoiseInsideBox(ctx, blob);

  ctx.strokeStyle = effect === "ascii"
    ? "rgba(255,110,110,0.46)"
    : "rgba(255,80,80,0.34)";
  ctx.lineWidth = 1;
  ctx.strokeRect(blob.x + 1, blob.y + 1, Math.max(0, blob.w - 2), Math.max(0, blob.h - 2));

  ctx.restore();
}

function drawMotionContent(ctx, motionMask, pixels, width, height, useAscii, useThermal, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const idx = y * width + x;
      if (motionMask[idx] !== 1) continue;

      const r = pixels[idx * 4];
      const g = pixels[idx * 4 + 1];
      const b = pixels[idx * 4 + 2];
      const brightness = (r + g + b) / 3 / 255;

      if (useAscii) {
        const charIdx = Math.floor(brightness * (asciiChars.length - 1));
        ctx.fillStyle = useThermal
          ? getThermalColor(brightness)
          : `rgba(${r},${g},${b},0.8)`;
        ctx.font = "8px monospace";
        ctx.fillText(asciiChars[charIdx], x, y);
      } else {
        ctx.fillStyle = useThermal
          ? getThermalColor(brightness)
          : `rgba(${r},${g},${b},0.82)`;
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }

  ctx.restore();
}

function applyGlitch(ctx, width, height) {
  if (!params.glitch || Math.random() > params.glitchChance) return;

  const slices = Math.floor(rand(1, 3));

  for (let i = 0; i < slices; i++) {
    const sy = Math.floor(rand(0, height - 20));
    const sh = Math.floor(rand(6, 18));
    const dx = Math.floor(rand(-12, 12));
    ctx.drawImage(ctx.canvas, 0, sy, width, sh, dx, sy, width, sh);
  }
}

// ================= SKETCH =================
const sketch = async () => {
  frameBufferCanvas = document.createElement("canvas");
  frameBufferCtx = frameBufferCanvas.getContext("2d");

  video = document.createElement("video");
  video.src = "video/india.mp4";
  video.loop = true;
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;

  await new Promise((resolve) => {
    video.onloadeddata = () => {
      video.play();
      resolve();
    };
  });

  audio = new Audio("audio/criswar.mp3");
  audio.loop = true;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;

  const source = audioCtx.createMediaElementSource(audio);
  source.connect(analyser);
  analyser.connect(audioCtx.destination);

  dataArray = new Uint8Array(analyser.frequencyBinCount);

  const startAudio = async () => {
    await audioCtx.resume();
    audio.play();
    window.removeEventListener("click", startAudio);
  };

  window.addEventListener("click", startAudio);

  let frameCount = 0;

  return ({ context, width, height }) => {
    frameCount++;

    if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

    frameBufferCanvas.width = width;
    frameBufferCanvas.height = height;

    frameBufferCtx.clearRect(0, 0, width, height);
    frameBufferCtx.drawImage(video, 0, 0, width, height);

    const frameData = frameBufferCtx.getImageData(0, 0, width, height);
    const pixels = frameData.data;

    const motionMask = new Uint8Array(width * height);

    if (previousFrame) {
      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
          const idx = y * width + x;
          const pi = idx * 4;

          const diff =
            Math.abs(pixels[pi] - previousFrame[pi]) +
            Math.abs(pixels[pi + 1] - previousFrame[pi + 1]) +
            Math.abs(pixels[pi + 2] - previousFrame[pi + 2]);

          if (diff > motionThreshold) {
            motionMask[idx] = 1;

            if (x + 2 < width) motionMask[y * width + (x + 2)] = 1;
            if (x - 2 >= 0) motionMask[y * width + (x - 2)] = 1;
            if (y + 2 < height) motionMask[(y + 2) * width + x] = 1;
            if (y - 2 >= 0) motionMask[(y - 2) * width + x] = 1;
          }
        }
      }
    }

    previousFrame = new Uint8ClampedArray(pixels);

    analyser.getByteFrequencyData(dataArray);
    const bass = getBassEnergy(dataArray) * params.sensitivity;
    const isBeat = bass > params.bassThreshold;
    const intensity = Math.min(1, bass / 255);

    const thermalReactiveAlpha = clamp(
      params.thermalMix * 0.65 + intensity * (params.thermalBeatBoost * 0.55) + (isBeat ? 0.08 : 0),
      0,
      0.65
    );

    const sceneMode = updateGlobalVisualState(frameCount);

    const blobs = params.blobTracking
      ? findBlobs(motionMask, width, height, params.minBlobSize, params.maxBoxes)
      : [];

    if (params.isolateToTrackedBoxes && blobs.length) {
      updateCropBgState(frameCount);
    }

    context.clearRect(0, 0, width, height);

    if (params.isolateToTrackedBoxes && blobs.length) {
      drawIsolatedTrackedBoxes(context, frameBufferCanvas, blobs, width, height);
    } else {
      context.drawImage(video, 0, 0, width, height);

      context.save();
      context.fillStyle = "rgba(0,0,0,0.14)";
      context.fillRect(0, 0, width, height);
      context.restore();
    }

    drawMotionContent(
      context,
      motionMask,
      pixels,
      width,
      height,
      false,
      false,
      params.isolateToTrackedBoxes ? 0.015 + intensity * 0.03 : 0.06 + intensity * 0.06
    );

    if (params.thermal && blobs.length) {
      drawThermalOnTrackedObjects(
        context,
        blobs,
        motionMask,
        pixels,
        width,
        height,
        frameCount,
        intensity,
        isBeat
      );
    }

    if (isBeat || sceneMode === "scan") {
      const edges = findEdges(motionMask, width, height);
      drawEdges(context, edges, outlineWidth + intensity * 2);
    }

    if (params.blobTracking) {
      blobs.forEach((blob, i) => {
        if (params.boxEffects) {
          renderEffectInsideBox(
            context,
            blob,
            pixels,
            width,
            height,
            frameCount,
            sceneMode,
            thermalReactiveAlpha,
            motionMask
          );
          drawBoxTag(context, blob);
        }

        if (sceneMode === "network" && params.networkMode) {
          drawBlobNetwork(context, blob, frameCount, motionMask, width, height);
        }

        drawDataHUD(context, blob, i, bass, frameCount);
        drawOuterTargetHUD(context, blob, i, bass, frameCount);
      });
    }

    if (params.isolateToTrackedBoxes && blobs.length) {
      drawAsciiObjectOutsideBoxes(
        context,
        motionMask,
        pixels,
        blobs,
        width,
        height,
        bass,
        frameCount
      );
    }

    applyGlitch(context, width, height);

    if (params.vignette) {
      drawVignette(context, width, height);
    }
  };
};

canvasSketch(sketch, settings);