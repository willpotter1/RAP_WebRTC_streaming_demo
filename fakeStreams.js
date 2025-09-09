// fakeStreams.js

/**
 * Converts a video URL to a MediaStream using canvas.captureStream.
 * @param {string} url - Public video file URL.
 * @param {number} fps - Frames per second to capture from canvas.
 * @param {number} width - Width of the canvas.
 * @param {number} height - Height of the canvas.
 * @returns {Promise<MediaStream>} - Resolves to a MediaStream.
 */

export const urls = ["/bunny.mp4", "/sintel.mp4", "/elephant.mp4"];

export async function streamFromUrl(url, fps = 30, width = 640, height = 360) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = url;
    video.crossOrigin = 'anonymous';
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.width = width;
    video.height = height;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Optional: keep the element for debugging
    document.body.appendChild(video);
    video.style.display = 'none';

    video.addEventListener('loadeddata', () => {
      video.play();

      function draw() {
        ctx.drawImage(video, 0, 0, width, height);
        requestAnimationFrame(draw);
      }
      draw();

      const stream = canvas.captureStream(fps);
      resolve(stream);
    });

    video.addEventListener('error', () => {
      reject(new Error(`Error loading video from ${url}`));
    });
  });
}

/**
 * Converts multiple video URLs to separate MediaStreams.
 * @param {string[]} urls - List of video URLs.
 * @returns {Promise<MediaStream[]>} - Resolves to an array of MediaStreams.
 */
export async function streamFromMultipleUrls(urls) {
  const promises = urls.map(url => streamFromUrl(url));
  return Promise.all(promises);
}

/* ------------------------------------------------------------------------ */
/*                👇 NEW: Live Images → MediaStream helpers                  */
/* ------------------------------------------------------------------------ */

/**
 * Create a steady-FPS video track fed by arbitrary images.
 * Returns { stream, push, stop }.
 * - push(src) accepts Blob | ArrayBuffer(View) | ImageBitmap | Canvas
 */
export function makeLiveImageTrack({ fps = 30, width = 1280, height = 720 } = {}) {
  const haveMSTG = typeof MediaStreamTrackGenerator === 'function';
  const haveOffscreen = typeof OffscreenCanvas === 'function';

  const canvas = haveOffscreen
    ? new OffscreenCanvas(width || 1, height || 1)
    : Object.assign(document.createElement('canvas'), { width: width || 1, height: height || 1 });
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

  const framePeriodMs = 1000 / fps;
  const framePeriodUs = Math.round(1e6 / fps); // number
  let tsUs = 0;                                // number (not BigInt)

  let running = true;
  let lastBitmap = null;

  let stream, track, writer = null;
  if (haveMSTG) {
    const gen = new MediaStreamTrackGenerator({ kind: 'video' });
    writer = gen.writable.getWriter();
    track = gen;
    stream = new MediaStream([gen]);
  } else {
    stream = canvas.captureStream(fps);         // Safari fallback
    track = stream.getVideoTracks()[0];
  }

  (async function pace() {
    while (running) {
      if (lastBitmap) {
        const w = width || lastBitmap.width || 1;
        const h = height || lastBitmap.height || 1;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w; canvas.height = h;
        }
        ctx.drawImage(lastBitmap, 0, 0, w, h);
        if (haveMSTG) {
          tsUs += framePeriodUs;
          const vf = new VideoFrame(canvas, { timestamp: tsUs });
          try { await writer.write(vf); } catch {}
          vf.close();
        }
      }
      await sleep(framePeriodMs);
    }
  })();

  async function push(src) {
    let bm = null;
    try {
      if (src instanceof ImageBitmap) {
        bm = src;
      } else if (src instanceof HTMLCanvasElement || src instanceof OffscreenCanvas) {
        bm = await createImageBitmap(src);
      } else if (src instanceof ArrayBuffer || ArrayBuffer.isView(src)) {
        bm = await createImageBitmap(new Blob([src]));
      } else {
        bm = await createImageBitmap(src); // Blob/File
      }
      const old = lastBitmap;
      lastBitmap = bm;
      if (old && old !== bm) old.close();
    } catch (e) {
      console.error('[makeLiveImageTrack] push() decode failed:', e);
    }
  }

  function stop() {
    running = false;
    try { writer?.close(); } catch {}
    try { track.stop?.(); } catch {}
    if (lastBitmap) { lastBitmap.close(); lastBitmap = null; }
  }

  return { stream, push, stop };
}

/**
 * Build a *live* MediaStream from images under ./temp170 (next to this file).
 * Uses a static Vite glob (string literal) compatible with Vite 2.0.x.
 *
 * @param {object} opts
 * @param {number} opts.fps
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {boolean} opts.loop
 * @returns {Promise<{stream: MediaStream, push: Function, stop: Function}>}
 */
export async function liveImageStreamFromFolder({
  fps = 12, width = 1280, height = 720, loop = true,
} = {}) {
  // Try module imports for non-TIFF assets first (optional; safe on Vite 2)
  const mods = import.meta.globEager('./temp170/*.{png,jpg,jpeg,webp}');
  let fileUrls = Object.values(mods).map(m => m.default);

  // Fallback: fetch from /public/temp170/manifest.json (handles TIFFs)
  if (fileUrls.length === 0) {
    try {
      const list = await (await fetch('/temp170/manifest.json', { cache: 'no-store' })).json();
      fileUrls = list.map(name => `/temp170/${name}`);
    } catch (e) {
      console.warn('[liveImage] no module-matched assets and no manifest found', e);
      fileUrls = [];
    }
  }

  console.log('[liveImage] using', fileUrls.length, 'files');
  const live = makeLiveImageTrack({ fps, width, height });

  if (fileUrls.length === 0) {
    console.warn('[liveImage] still no files; emitting synthetic frames for sanity');
    emitColorBars(live, { fps, width, height });
    return live;
  }

  (async function trickle() {
    const delayMs = Math.max(1, Math.round(1000 / fps));
    let i = 0;
    while (true) {
      const url = fileUrls[i];
      try {
        const bmp = await fetchAsImageBitmap(url); // TIFF handled by UTIF in fetchAsImageBitmap
        await live.push(bmp);
      } catch (e) {
        console.error('[liveImage] decode failed for', url, e);
      }
      await sleep(delayMs);
      i = (i + 1) % fileUrls.length;
      if (!loop && i === 0) break;
    }
  })();

  return live;
}





/* --------------------------- internal helpers --------------------------- */

async function fetchAsImageBitmap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  const buf = await res.arrayBuffer();

  const ext = url.split('.').pop().toLowerCase();
  const isTiff = ext === 'tif' || ext === 'tiff';

  if (!isTiff) {
    return await createImageBitmap(new Blob([buf]));
  }

  // ---- TIFF decode via UTIF (handle both v2 & v3 APIs) ----
  const UTIF = await loadUTIF();
  const ifds = UTIF.decode(buf);

  // Some builds export decodeImages(), others only decodeImage()
  if (typeof UTIF.decodeImages === 'function') {
    UTIF.decodeImages(buf, ifds);
  } else if (typeof UTIF.decodeImage === 'function') {
    for (const ifd of ifds) UTIF.decodeImage(buf, ifd);
  } else {
    throw new Error('UTIF: no decodeImage(s) function available');
  }

  const first = ifds[0];
  const rgba = UTIF.toRGBA8(first); // Uint8Array RGBA
  const w = first.width, h = first.height;

  const off = (typeof OffscreenCanvas === 'function')
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });

  const ctx = off.getContext('2d', { alpha: true });
  const imgData = new ImageData(new Uint8ClampedArray(rgba), w, h);
  ctx.putImageData(imgData, 0, 0);

  return await createImageBitmap(off);
}


function loadUTIF() {
  if (window.UTIF) return Promise.resolve(window.UTIF);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/utif@3.0.0/UTIF.min.js';
    s.onload = () => resolve(window.UTIF);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function emitColorBars(live, { fps, width, height }) {
  const cvs = document.createElement('canvas');
  cvs.width = width; cvs.height = height;
  const ctx = cvs.getContext('2d');
  let t = 0;

  (async function loop() {
    const colors = ['#f44336','#ff9800','#ffeb3b','#4caf50','#2196f3','#3f51b5'];
    ctx.fillStyle = colors[t % colors.length];
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#111';
    ctx.font = '48px sans-serif';
    ctx.fillText(`liveImage t=${t}`, 40, 80);
    t++;
    live.push(await createImageBitmap(cvs));
    setTimeout(loop, Math.max(1, Math.round(1000 / fps)));
  })();
}


