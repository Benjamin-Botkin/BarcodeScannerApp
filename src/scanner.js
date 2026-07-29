import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) =>
      path.endsWith(".wasm")
        ? `${import.meta.env.BASE_URL}zxing_reader.wasm`
        : prefix + path,
  },
});

const READER_OPTIONS = {
  tryHarder: true,
  formats: ["QRCode", "DataMatrix", "Aztec", "PDF417", "AllLinear"],
  maxNumberOfSymbols: 1,
  // Morphological closing pass that cleans up noisy module edges on dense 2D
  // codes. Marked @experimental upstream, applies to 2D symbologies only (no
  // effect on AllLinear), and costs one extra CPU pass per decode — this is
  // the first line to revert if decode latency regresses.
  tryDenoise: true,
};
// tryRotate / tryInvert / tryDownscale / binarizer: "LocalAverage" are already
// the zxing-wasm defaults, so setting them here would be a no-op.

const SCAN_INTERVAL_MS = 300;

// Ask for the highest feed the camera will give us. Without these, Safari
// negotiates a low default (often 640x480), and since decoding crops to the
// viewfinder in *native video pixels*, a small barcode ends up backed by only
// a handful of real samples. These are `ideal`, which only affects fitness
// scoring — unlike min/max/exact they can never cause getUserMedia to reject.
const CAPTURE_WIDTH_IDEAL = 3840;
const CAPTURE_HEIGHT_IDEAL = 2160;

// If the cropped viewfinder region is smaller than this, scale it up before
// decoding. This invents no detail; it just gives the binarizer's local-average
// window more samples to work with when a module was originally only 1-2 pixels
// wide. A fallback for feeds that negotiate low despite the request above.
const MIN_DECODE_DIMENSION_PX = 900;
const MAX_UPSCALE_FACTOR = 3;

// Video is displayed with object-fit: cover, so it's uniformly scaled up
// until it fills the display box, with any excess cropped off-center.
// This maps the on-screen viewfinder rect back to the matching region in
// the video's native pixel coordinates, so decoding only looks there.
function getViewfinderVideoRect(video, viewfinderRect) {
  const videoRect = video.getBoundingClientRect();
  const scale = Math.max(
    videoRect.width / video.videoWidth,
    videoRect.height / video.videoHeight,
  );
  const renderedW = video.videoWidth * scale;
  const renderedH = video.videoHeight * scale;
  const cropX = (renderedW - videoRect.width) / 2;
  const cropY = (renderedH - videoRect.height) / 2;

  const relLeft = viewfinderRect.left - videoRect.left;
  const relTop = viewfinderRect.top - videoRect.top;

  const x = Math.max(0, (relLeft + cropX) / scale);
  const y = Math.max(0, (relTop + cropY) / scale);
  const w = Math.min(viewfinderRect.width / scale, video.videoWidth - x);
  const h = Math.min(viewfinderRect.height / scale, video.videoHeight - y);
  return { x, y, w, h };
}

export class Scanner {
  constructor({ video, canvas, viewfinder, onResult }) {
    this.video = video;
    this.canvas = canvas;
    this.viewfinder = viewfinder;
    this.ctx = canvas.getContext("2d", { willReadFrequently: true });
    this.onResult = onResult;
    this.stream = null;
    this.timerId = null;
    this.busy = false;
    this.paused = false;
    this._zeroDimCount = 0;
    // Tracks the last logged upscale factor so a renegotiated feed is visible
    // in the debug overlay without logging on every tick.
    this._loggedScale = null;
  }

  async start() {
    const videoConstraints = {
      facingMode: { ideal: "environment" },
      width: { ideal: CAPTURE_WIDTH_IDEAL },
      height: { ideal: CAPTURE_HEIGHT_IDEAL },
    };
    console.log("Requesting camera...", videoConstraints);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        // Best-effort autofocus hint. iOS Safari doesn't reliably support
        // focusMode/torch/zoom, so it goes in `advanced`, which is ignored
        // when unsupported rather than failing the request.
        video: { ...videoConstraints, advanced: [{ focusMode: "continuous" }] },
        audio: false,
      });
    } catch (err) {
      // Hedge against WebKit quirks with the `advanced` array specifically —
      // the ideal values above cannot themselves cause a rejection. A denial
      // or missing camera won't be fixed by retrying, and retrying would just
      // prompt the user a second time.
      if (err.name === "NotAllowedError" || err.name === "NotFoundError") throw err;
      console.warn("Camera request with focus hint failed, retrying:", err);
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });
    }
    const [track] = this.stream.getVideoTracks();
    console.log(
      "Got stream. Track:",
      track?.label,
      "requested:",
      { width: CAPTURE_WIDTH_IDEAL, height: CAPTURE_HEIGHT_IDEAL },
      "settings:",
      track?.getSettings ? track.getSettings() : "n/a",
    );
    console.log(
      "Track capabilities:",
      track?.getCapabilities ? track.getCapabilities() : "n/a",
    );

    this.video.addEventListener("loadedmetadata", () => {
      console.log(
        `video loadedmetadata: ${this.video.videoWidth}x${this.video.videoHeight}, readyState=${this.video.readyState}`,
      );
    });
    this.video.addEventListener("playing", () => {
      console.log("video playing event fired");
    });
    this.video.addEventListener("error", (e) => {
      console.error("video element error:", this.video.error, e);
    });

    this.video.srcObject = this.stream;
    try {
      await this.video.play();
      console.log("video.play() resolved");
    } catch (err) {
      console.error("video.play() rejected:", err);
      throw err;
    }
    this.timerId = setInterval(() => this._tick(), SCAN_INTERVAL_MS);
    console.log("Scan loop started, interval ms =", SCAN_INTERVAL_MS);
  }

  stop() {
    if (this.timerId) clearInterval(this.timerId);
    this.timerId = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  async _tick() {
    if (this.busy || this.paused) return;
    if (!this.video.videoWidth || !this.video.videoHeight) {
      this._zeroDimCount++;
      if (this._zeroDimCount === 1 || this._zeroDimCount % 20 === 0) {
        console.warn(
          `Skipping tick #${this._zeroDimCount}: video has zero dimensions (videoWidth=${this.video.videoWidth}, readyState=${this.video.readyState}, paused=${this.video.paused})`,
        );
      }
      return;
    }

    this.busy = true;
    try {
      const viewfinderRect = this.viewfinder.getBoundingClientRect();
      const { x, y, w, h } = getViewfinderVideoRect(
        this.video,
        viewfinderRect,
      );
      const minDim = Math.min(w, h);
      const scale =
        minDim < MIN_DECODE_DIMENSION_PX
          ? Math.min(MAX_UPSCALE_FACTOR, MIN_DECODE_DIMENSION_PX / minDim)
          : 1;
      // Floor rather than round: the canvas width/height setters truncate, and
      // asking getImageData for more pixels than the canvas has would pad the
      // buffer with transparent black.
      const cw = Math.floor(scale > 1 ? w * scale : w);
      const ch = Math.floor(scale > 1 ? h * scale : h);

      if (this._loggedScale !== scale) {
        console.log(
          `Decode region in video space: ${w.toFixed(0)}x${h.toFixed(0)} at (${x.toFixed(0)},${y.toFixed(0)}), upscale=${scale.toFixed(2)}x -> ${cw}x${ch}`,
        );
        this._loggedScale = scale;
      }

      this.canvas.width = cw;
      this.canvas.height = ch;
      // Canvas resize resets context state, so these must be set per tick.
      this.ctx.imageSmoothingEnabled = scale > 1;
      if (scale > 1) this.ctx.imageSmoothingQuality = "high";
      this.ctx.drawImage(this.video, x, y, w, h, 0, 0, cw, ch);
      const imageData = this.ctx.getImageData(0, 0, cw, ch);

      const results = await readBarcodes(imageData, READER_OPTIONS);
      if (results.length > 0) {
        console.log("Decoded:", results[0].format, results[0].text);
        this.onResult(results[0]);
      }
    } catch (err) {
      console.error("Decode error:", err);
    } finally {
      this.busy = false;
    }
  }
}
