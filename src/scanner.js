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
};

const SCAN_INTERVAL_MS = 300;

export class Scanner {
  constructor({ video, canvas, onResult }) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { willReadFrequently: true });
    this.onResult = onResult;
    this.stream = null;
    this.timerId = null;
    this.busy = false;
    this.paused = false;
    this._zeroDimCount = 0;
    this._loggedFirstDecodeAttempt = false;
  }

  async start() {
    console.log("Requesting camera...");
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    const [track] = this.stream.getVideoTracks();
    console.log(
      "Got stream. Track:",
      track?.label,
      "settings:",
      track?.getSettings ? track.getSettings() : "n/a",
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
      const { videoWidth: w, videoHeight: h } = this.video;
      if (!this._loggedFirstDecodeAttempt) {
        console.log(`First decode attempt on frame ${w}x${h}`);
        this._loggedFirstDecodeAttempt = true;
      }
      this.canvas.width = w;
      this.canvas.height = h;
      this.ctx.drawImage(this.video, 0, 0, w, h);
      const imageData = this.ctx.getImageData(0, 0, w, h);

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
