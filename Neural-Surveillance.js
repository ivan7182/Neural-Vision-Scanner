const canvasSketch = require("canvas-sketch");
const { Pane } = require("tweakpane");

const settings = {
  dimensions: [1080, 1920],
  animate: true,
  pixelRatio: 1
};

let video;
let audio;
let audioCtx;
let analyser;
let dataArray;
let previousFrame = null;
let currentEffect = 0;
let renderMode = 2; // default video asli
let globalFrameTick = 0;

const effects = [
  "ascii",
  "bw",
  "pixel",
  "thermal"
];

const asciiChars = " .:-=+*#%@";

// ================= PNG RECORDER =================

let recording = false;
let frame = 0;

window.addEventListener("keydown", (e) => {
  if (e.key === "r") {
    recording = true;
    frame = 0;
    console.log("RECORD START");
  }
  if (e.key === "s") {
    recording = false;
    console.log("RECORD STOP");
  }

  // ganti mode manual
  if (e.key === "1") {
    renderMode = 0;
    console.log("MODE 0 = FULL EFFECT");
  }
  if (e.key === "2") {
    renderMode = 1;
    console.log("MODE 1 = EFFECT ONLY OBJECT");
  }
  if (e.key === "3") {
    renderMode = 2;
    console.log("MODE 2 = VIDEO ORIGINAL");
  }
});

// ================= PARAMS =================

const params = {
  threshold: 80,
  darkThreshold: 90,
  asciiOnlyOnDarkObject: true,
  asciiCellSize: 14,
  blueBackgroundOnAscii: true,
  minBlueBlobSize: 1200,
  minBlueBlobWidth: 80,
  minBlueBlobHeight: 80,

  bgPulseFrames: 16,
  asciiGlow: 8,
  asciiStroke: 2,
  asciiBoost: 1.35,
  asciiMinAlpha: 0.9
};
let motionThreshold = params.threshold;

// ================= TWEAKPANE =================

const pane = new Pane();
pane.addInput(params, "threshold", {
  min: 10,
  max: 200,
  step: 1,
  label: "scan threshold"
}).on("change", (v) => {
  motionThreshold = v.value;
});

pane.addInput(params, "darkThreshold", {
  min: 0,
  max: 255,
  step: 1,
  label: "dark threshold"
});

pane.addInput(params, "asciiOnlyOnDarkObject", {
  label: "ascii dark object"
});

pane.addInput(params, "asciiCellSize", {
  min: 6,
  max: 30,
  step: 1,
  label: "ascii cell"
});

pane.addInput(params, "blueBackgroundOnAscii", {
  label: "blue bg ascii"
});

pane.addInput(params, "minBlueBlobSize", {
  min: 100,
  max: 10000,
  step: 50,
  label: "min blue size"
});

pane.addInput(params, "minBlueBlobWidth", {
  min: 10,
  max: 400,
  step: 5,
  label: "min blue w"
});

pane.addInput(params, "minBlueBlobHeight", {
  min: 10,
  max: 400,
  step: 5,
  label: "min blue h"
});

pane.addInput(params, "bgPulseFrames", {
  min: 4,
  max: 60,
  step: 1,
  label: "bg pulse"
});

pane.addInput(params, "asciiGlow", {
  min: 0,
  max: 20,
  step: 1,
  label: "ascii glow"
});

pane.addInput(params, "asciiStroke", {
  min: 0,
  max: 6,
  step: 0.5,
  label: "ascii stroke"
});

pane.addInput(params, "asciiBoost", {
  min: 1,
  max: 2.5,
  step: 0.05,
  label: "ascii boost"
});

pane.addInput(params, "asciiMinAlpha", {
  min: 0.1,
  max: 1,
  step: 0.05,
  label: "ascii alpha"
});

// ================= HUD =================

function drawHUD(ctx, x, y, w, h) {
  ctx.strokeStyle = "lime";
  ctx.lineWidth = 2;
  const c = 20;

  ctx.beginPath();
  ctx.moveTo(x, y + c);
  ctx.lineTo(x, y);
  ctx.lineTo(x + c, y);

  ctx.moveTo(x + w - c, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + c);

  ctx.moveTo(x, y + h - c);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x + c, y + h);

  ctx.moveTo(x + w - c, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w, y + h - c);

  ctx.stroke();

  ctx.fillStyle = "lime";
  ctx.font = "14px monospace";
  ctx.fillText("TARGET", x, y - 10);
}

// ================= BLOB DETECTION =================

function findBlobs(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const blobs = [];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];

  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0 || visited[i]) continue;

    let stack = [i];
    let size = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;

    while (stack.length) {
      const index = stack.pop();
      if (visited[index]) continue;
      visited[index] = 1;
      if (mask[index] === 0) continue;

      size++;
      const x = index % width;
      const y = Math.floor(index / width);

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (const d of dirs) {
        const nx = x + d[0];
        const ny = y + d[1];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (!visited[ni]) stack.push(ni);
      }
    }

    if (size > 300) {
      blobs.push({
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
        size
      });
    }
  }

  blobs.sort((a, b) => b.size - a.size);
  return blobs.slice(0, 6);
}

// ================= THERMAL COLOR =================

function getThermalColor(v) {
  let r = 0;
  let g = 0;
  let b = 0;

  if (v < 0.25) {
    r = 0;
    g = v * 4 * 255;
    b = 255;
  } else if (v < 0.5) {
    r = 0;
    g = 255;
    b = (1 - (v - 0.25) * 4) * 255;
  } else if (v < 0.75) {
    r = (v - 0.5) * 4 * 255;
    g = 255;
    b = 0;
  } else {
    r = 255;
    g = (1 - (v - 0.75) * 4) * 255;
    b = 0;
  }

  return `rgb(${r},${g},${b})`;
}

function getAsciiCharFromBrightness(avg) {
  const normalized = avg / 255;
  const index = Math.min(
    asciiChars.length - 1,
    Math.floor(normalized * (asciiChars.length - 1))
  );
  return asciiChars[index];
}

function getAsciiCharForDarkObject(avg) {
  const normalized = avg / 255;
  const reversed = 1 - normalized;
  const boosted = Math.min(1, reversed * params.asciiBoost);
  const index = Math.min(
    asciiChars.length - 1,
    Math.floor(boosted * (asciiChars.length - 1))
  );
  return asciiChars[index];
}

// ================= SKETCH =================

const sketch = async () => {
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
  analyser.fftSize = 512;

  const source = audioCtx.createMediaElementSource(audio);
  source.connect(analyser);
  analyser.connect(audioCtx.destination);

  dataArray = new Uint8Array(analyser.frequencyBinCount);

  window.addEventListener("click", () => {
    audioCtx.resume();
    audio.play();
  });

  return ({ context, width, height }) => {
    if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

    globalFrameTick++;

    // ambil frame video asli
    context.drawImage(video, 0, 0, width, height);

    analyser.getByteFrequencyData(dataArray);
    const bass = dataArray[2];

    // random effect + mode pas bass naik
    if (bass > 200) {
      currentEffect = Math.floor(Math.random() * effects.length);
      renderMode = Math.floor(Math.random() * 3); // 0, 1, 2
    }

    const frameData = context.getImageData(0, 0, width, height);
    const pixels = frameData.data;

    const motionMask = new Uint8Array(width * height);
    const objectMask = new Uint8Array(width * height);

    if (previousFrame) {
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];

        const diff =
          Math.abs(pixels[i] - previousFrame[i]) +
          Math.abs(pixels[i + 1] - previousFrame[i + 1]) +
          Math.abs(pixels[i + 2] - previousFrame[i + 2]);

        const avg = (r + g + b) / 3;
        const isDark = avg <= params.darkThreshold;
        const isMotion = diff > motionThreshold;

        if (isMotion) {
          motionMask[i / 4] = 1;
        }

        if (isMotion && isDark) {
          objectMask[i / 4] = 1;
        }
      }
    }

    previousFrame = new Uint8ClampedArray(pixels);

    const blobs = findBlobs(objectMask, width, height);
    const hasDetection = blobs.length > 0;

    const strongBlueDetection = blobs.some((blob) => {
      return (
        blob.size >= params.minBlueBlobSize &&
        blob.w >= params.minBlueBlobWidth &&
        blob.h >= params.minBlueBlobHeight
      );
    });

    const asciiDetectionMode =
      params.blueBackgroundOnAscii &&
      strongBlueDetection &&
      effects[currentEffect] === "ascii";

    const pulseBlue =
      asciiDetectionMode &&
      Math.floor(globalFrameTick / params.bgPulseFrames) % 2 === 0;

    // mode 2 = video asli tanpa effect
    if (renderMode === 2) {
      if (asciiDetectionMode) {
        context.fillStyle = pulseBlue ? "rgb(0,80,255)" : "black";
        context.fillRect(0, 0, width, height);
      } else {
        context.drawImage(video, 0, 0, width, height);
      }
    } else {
      if (asciiDetectionMode) {
        context.fillStyle = pulseBlue ? "rgb(0,80,255)" : "black";
      } else {
        context.fillStyle = "black";
      }
      context.fillRect(0, 0, width, height);

      const size = 10;
      context.font = `${size}px monospace`;
      context.textBaseline = "top";

      function drawCell(x, y) {
        const index = y * width + x;
        const i = index * 4;

        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];

        if (r === undefined || g === undefined || b === undefined) return;

        if (effects[currentEffect] === "thermal") {
          const bright = (r + g + b) / 3 / 255;
          context.fillStyle = getThermalColor(bright);
          context.fillRect(x, y, size, size);
        } else if (effects[currentEffect] === "bw") {
          const avg = (r + g + b) / 3;
          context.fillStyle = `rgb(${avg},${avg},${avg})`;
          context.fillRect(x, y, size, size);
        } else if (effects[currentEffect] === "pixel") {
          context.fillStyle = `rgb(${r},${g},${b})`;
          context.fillRect(x, y, size, size);
        } else if (effects[currentEffect] === "ascii") {
          const avg = (r + g + b) / 3;
          const char = getAsciiCharFromBrightness(avg);

          context.save();
          context.shadowColor = "rgba(255,255,255,0.85)";
          context.shadowBlur = 4;
          context.strokeStyle = "rgba(0,0,0,0.8)";
          context.lineWidth = 1.5;
          context.fillStyle = "white";
          context.strokeText(char, x, y);
          context.fillText(char, x, y);
          context.restore();
        }
      }

      function insideBlob(x, y) {
        for (const blob of blobs) {
          if (
            x > blob.x &&
            x < blob.x + blob.w &&
            y > blob.y &&
            y < blob.y + blob.h
          ) {
            return true;
          }
        }
        return false;
      }

      for (let y = 0; y < height; y += size) {
        for (let x = 0; x < width; x += size) {
          if (renderMode === 0) {
            drawCell(x, y);
          } else if (renderMode === 1 && insideBlob(x, y)) {
            drawCell(x, y);
          }
        }
      }
    }

    // ================= ASCII KHUSUS OBJECT SAAT GELAP =================
    if (
      params.asciiOnlyOnDarkObject &&
      hasDetection &&
      effects[currentEffect] === "ascii"
    ) {
      const asciiSize = params.asciiCellSize;
      context.save();
      context.font = `bold ${asciiSize}px monospace`;
      context.textBaseline = "top";
      context.lineJoin = "round";
      context.shadowColor = "rgba(255,255,255,0.95)";
      context.shadowBlur = params.asciiGlow;
      context.strokeStyle = pulseBlue
        ? "rgba(0,0,0,0.95)"
        : "rgba(0,120,255,0.95)";
      context.lineWidth = params.asciiStroke;

      for (const blob of blobs) {
        if (blob.w < 20 || blob.h < 20) continue;

        for (let y = blob.y; y < blob.y + blob.h; y += asciiSize) {
          for (let x = blob.x; x < blob.x + blob.w; x += asciiSize) {
            const px = Math.floor(x);
            const py = Math.floor(y);

            if (px < 0 || py < 0 || px >= width || py >= height) continue;

            const idx = py * width + px;
            if (!objectMask[idx]) continue;

            const i = idx * 4;
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];

            if (r === undefined || g === undefined || b === undefined) continue;

            const avg = (r + g + b) / 3;

            if (avg <= params.darkThreshold) {
              const char = getAsciiCharForDarkObject(avg);
              const alpha = Math.max(
                params.asciiMinAlpha,
                1 - avg / Math.max(1, params.darkThreshold)
              );

              context.fillStyle = `rgba(255,255,255,${alpha})`;
              context.strokeText(char, x, y);
              context.fillText(char, x, y);
            }
          }
        }
      }

      context.restore();
    }

    // HUD tetap tampil
    for (const blob of blobs) {
      if (blob.w > 40 && blob.h > 40) {
        drawHUD(context, blob.x, blob.y, blob.w, blob.h);
      }
    }

    // SAVE PNG
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