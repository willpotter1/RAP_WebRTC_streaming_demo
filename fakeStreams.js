// streamFromUrls.js

/**
 * Converts a video URL to a MediaStream using canvas.captureStream.
 * @param {string} url - Public video file URL.
 * @param {number} fps - Frames per second to capture from canvas.
 * @param {number} width - Width of the canvas.
 * @param {number} height - Height of the canvas.
 * @returns {Promise<MediaStream>} - Resolves to a MediaStream.
 */

export const urls = ["/bunny.mp4",
                     "/sintel.mp4",
                     "/elephant.mp4"
                     ];

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

    document.body.appendChild(video);  // Optional: helpful for debugging
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

    video.addEventListener('error', (e) => {
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
