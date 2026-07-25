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
  formats: ["QRCode", "DataMatrix", "Aztec", "PDF417"],
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
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.timerId = setInterval(() => this._tick(), SCAN_INTERVAL_MS);
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
    if (!this.video.videoWidth || !this.video.videoHeight) return;

    this.busy = true;
    try {
      const { videoWidth: w, videoHeight: h } = this.video;
      this.canvas.width = w;
      this.canvas.height = h;
      this.ctx.drawImage(this.video, 0, 0, w, h);
      const imageData = this.ctx.getImageData(0, 0, w, h);

      const results = await readBarcodes(imageData, READER_OPTIONS);
      if (results.length > 0) {
        this.onResult(results[0]);
      }
    } catch (err) {
      console.error("Decode error:", err);
    } finally {
      this.busy = false;
    }
  }
}
