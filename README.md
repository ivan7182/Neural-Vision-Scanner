# Neural Vision Scanner

Experimental **computer vision system** that combines **motion tracking, surveillance aesthetics, and generative visual rendering** using **JavaScript** and **HTML5 Canvas**.

This project merges multiple visual scanning systems such as **Tracked Echo Scanner** and **Neural Surveillance**, creating an artificial vision interface that detects motion and transforms it into dynamic visual feedback.

The system simulates a **synthetic surveillance camera** that reacts to movement and audio, generating visual effects such as scanning overlays, motion echoes, and AI-like tracking.

---

## Preview

Example visuals produced by the system:

- Motion tracking boxes
- Echo motion trails
- Scanner HUD overlay
- Surveillance-style visual interface


---

## Features

- Motion detection from webcam video
- Blob tracking of moving objects
- Echo tracking system (**Tracked Echo Scanner**)
- Neural surveillance visual interface
- Real-time visual scanning effects
- Audio-reactive visual triggers
- Parameter control using **Tweakpane**
- Real-time canvas rendering

---

## Technologies Used

- **JavaScript**
- **canvas-sketch**
- **Tweakpane**
- **Web Audio API**
- **Motion detection algorithms**

---

## How It Works

1. Webcam frames are captured in real time.
2. The system analyzes pixel differences between frames.
3. Moving regions are detected and grouped into motion blobs.
4. Tracking boxes follow the detected movement.
5. Visual effects are generated based on motion and audio input.

The result is a **synthetic vision interface** that behaves like an artificial surveillance system.

---

## Installation

Clone the repository:

```bash
git clone https://github.com/ivan7182/neural-vision-scanner.git
```

Install dependencies:

```bash
npm install
```

Run the project:

```bash
npm run dev
```

---

## Controls

### Keyboard

```
R → Start recording
S → Stop recording
```

Parameters can also be adjusted in real time using the **Tweakpane control panel**.

---

## Inspiration

This project is inspired by:

- Computer vision interfaces
- Surveillance camera aesthetics
- Generative media art
- Experimental creative coding

---

## Possible Applications

- Interactive installations
- Live visual performances
- Digital media art
- Creative coding experiments
- Computer vision prototypes

---

## Author

Creative coding & experimental computer vision project by **vansatt**
