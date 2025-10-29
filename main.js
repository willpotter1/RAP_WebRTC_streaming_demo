// main.js
import './style.css';
import { streamFromMultipleUrls, urls, liveImageStreamFromFolder } from './fakeStreams.js';
import { Signaler } from './signalling.js';

// —————— Common Setup ——————
const iceConfig = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302','stun:stun2.l.google.com:19302'] }
  ],
  iceCandidatePoolSize: 10,
};

const sig = new Signaler('ws://localhost:8080');

// —————— Shared State ——————
let role = null;                      // "streamer" or "viewer"
let localStreams = [];   // Array<MediaStream> for the 3 fake videos
window.localStreams = localStreams;
const remoteStream = new MediaStream();

const pcs = {};                       // streamer: viewerId → RTCPeerConnection
let viewerPc = null;     // viewer’s RTCPeerConnection
window.pcs = pcs;
window.viewerPc = null;

globalThis.pcs = pcs;           // use globalThis to be 100% robust
globalThis.viewerPc = null;
globalThis.localStreams = localStreams;

let dataChannel = null;               // viewer’s DataChannel

// —————— Display Your Peer ID ——————
sig.on('welcome', (_, id) => {
  document.getElementById('myIdDisplay').textContent = id;
});

// —————— Role Initialization ——————
document.getElementById('initButton').onclick = () => {
  role = document.getElementById('roleSelect').value;
  const sc = document.getElementById('streamerControls');
  const vc = document.getElementById('viewerControls');
  const peerIdSection = document.getElementById('peerIdSection');

  if (role === 'streamer') {
    sc.style.display = 'block';
    vc.style.display = 'none';
    peerIdSection.hidden = false;
    setupStreamer();
  } else {
    sc.style.display = 'none';
    vc.style.display = 'block';
    peerIdSection.hidden = true;
    setupViewer();
  }
};



// —————— STREAMER Flow ——————
// —————— STREAMER Flow ——————
function setupStreamer() {
  // 1) Load & preview all 3 streams
  document.getElementById('startStream').onclick = async () => {
    localStreams = await streamFromMultipleUrls(urls);
    window.localStreams = localStreams;
    console.log('[Streamer] Video streams loaded:', localStreams.length);
    localStreams.forEach((stream, i) => {
      const pv = document.getElementById(`preview${i}`);
      if (pv) pv.srcObject = stream;
    });

    // --- NEW: add the Live Images stream as index 3 (INSIDE the async handler) ---
    const live = await liveImageStreamFromFolder({
      fps: 12,            // adjust as you like
      width: 1280,
      height: 720,
      loop: true,
    });
    window.liveImage = live;          // optional
    localStreams.push(live.stream);   // becomes index 3

    const p3 = document.getElementById('preview3');
    if (p3) p3.srcObject = live.stream;


  // ✅ Force renegotiation so new timestamped stream info propagates
      console.log('[Streamer] Renegotiating after adding live stream...');
      for (const [id, pc] of Object.entries(pcs)) {
        try {
          for (const stream of localStreams) {
            for (const track of stream.getTracks()) {
              if (!pc.getSenders().some(s => s.track === track)) {
                pc.addTrack(track, stream);
              }
            }
          }
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sig.send(id, 'sdp-offer', offer);
          console.log(`[Streamer] Renegotiation sent to ${id}`);
        } catch (err) {
          console.warn(`[Streamer] Renegotiation failed for ${id}:`, err);
        }
      }
    };

  // 2) Answer each viewer’s offer on its own PC
  sig.on('sdp-offer', async (from, offer) => {
    if (role !== 'streamer' || localStreams.length === 0) return;

    if (!pcs[from]) {
      const pc = new RTCPeerConnection(iceConfig);
      globalThis._lastPc = pc;

      // ✅ Add all active video tracks from every local stream
      for (const stream of localStreams) {
        for (const track of stream.getTracks()) {
          pc.addTrack(track, stream);
        }
      }

      pc.ondatachannel = ({ channel }) => {
        channel.onmessage = (ev) => {
          const idx = parseInt(ev.data, 10);
          if (idx >= 0 && idx < localStreams.length) {
            const newTrack = localStreams[idx].getVideoTracks()[0];
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            sender?.replaceTrack(newTrack);
          }
        };
      };

      pc.onicecandidate = e => {
        if (e.candidate) sig.send(from, 'ice-candidate', e.candidate.toJSON());
      };

      pcs[from] = pc;
    }

    const pc = pcs[from];
    globalThis._lastPc = pc;

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sig.send(from, 'sdp-answer', answer);
    console.log(`[Streamer] Answered viewer ${from} with ${localStreams.length} streams`);
  });


  sig.on('ice-candidate', async (from, candidate) => {
    if (role !== 'streamer') return;
    const pc = pcs[from];
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
  });
}



// —————— VIEWER Flow ——————
function setupViewer() {
  const remoteVideo = document.getElementById('remoteVideo');
  remoteVideo.srcObject = remoteStream;


  remoteVideo.muted = true;
  remoteVideo.playsInline = true;

  function installVisibilityGuards(videoEl) {
    const resume = () => videoEl.play().catch(()=>{});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') resume();
    });
    window.addEventListener('focus', resume);
  }
  installVisibilityGuards(remoteVideo);

  // Disable stream select until DC opens
  const selectEl = document.getElementById('streamSelect');
  selectEl.disabled = true;

  const pendingCandidates = [];
  document.getElementById('streamSelect').onchange = e => {
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(e.target.value);
    }
  };

  document.getElementById('connectBtn').onclick = async () => {
    const to = document.getElementById('streamerIdInput').value.trim();
    if (!to) return alert('Please enter the Streamer ID');

    // 1) Create PC
    viewerPc = new RTCPeerConnection(iceConfig);
    globalThis.viewerPc = viewerPc;

    // 2) recvonly video
    viewerPc.addTransceiver('video', { direction: 'recvonly' });

    // 3) DataChannel
    dataChannel = viewerPc.createDataChannel('chat');
    dataChannel.onopen = () => { console.log('Chat open'); selectEl.disabled = false; };
    dataChannel.onmessage = e => console.log('Message from streamer:', e.data);

    // 4) ICE to streamer
    viewerPc.onicecandidate = e => {
      if (e.candidate) sig.send(to, 'ice-candidate', e.candidate.toJSON());
    };

    // 5) Incoming media → bind & mirror to canvas
    viewerPc.ontrack = (e) => {
      // replace any previous video track
      remoteStream.getVideoTracks().forEach(t => remoteStream.removeTrack(t));
      remoteStream.addTrack(e.track);

      remoteVideo.srcObject = remoteStream;
      remoteVideo.muted = true;        // allow autoplay reliably
      remoteVideo.playsInline = true;

      let started = false;

      const startWhenReady = async () => {
        try { await remoteVideo.play(); } catch {}

        // Wait until the element knows its size at least once
        if (!remoteVideo.videoWidth || !remoteVideo.videoHeight) {
          await new Promise(res => {
            const onMeta = () => { remoteVideo.removeEventListener('loadedmetadata', onMeta); res(); };
            remoteVideo.addEventListener('loadedmetadata', onMeta, { once: true });
          });
        }
        if (started) return;
        started = true;

        // Canvas setup
        const canvas = document.createElement('canvas');
        canvas.id = 'remoteCanvas';
        canvas.width  = remoteVideo.videoWidth  || 320;
        canvas.height = remoteVideo.videoHeight || 180;
        const ctx = canvas.getContext('2d', { alpha: false });
        document.getElementById('viewerControls').appendChild(canvas);

        // Keep <video> renderable (avoid display:none)
        Object.assign(remoteVideo.style, {
          position: 'absolute',
          left: '-99999px',
          top: '-99999px',
          width: '1px',
          height: '1px',
          opacity: '0'
        });

        // --- DEBUG OVERLAY (helps you see what stops) ---
        const overlay = document.createElement('div');
        overlay.style.cssText =
          'position:absolute;right:8px;top:8px;background:rgba(0,0,0,.6);color:#0f0;' +
          'font:12px monospace;padding:6px 8px;border-radius:6px;z-index:9999;white-space:pre';
        document.body.appendChild(overlay);

        let draws = 0, vfcCalls = 0, lastT = performance.now(), framesDecoded = 0;

        const recv = () => viewerPc?.getReceivers()?.find(r => r.track?.kind === 'video');
        const statsTimer = setInterval(async () => {
          try {
            const r = recv(); if (!r) return;
            const s = await r.getStats();
            s.forEach(o => {
              if (o.type === 'inbound-rtp' && o.kind === 'video') framesDecoded = o.framesDecoded ?? 0;
            });
          } catch {}
        }, 1000);

        const overlayTimer = setInterval(() => {
          const now = performance.now();
          const dt = Math.max(1, (now - lastT) / 1000);
          overlay.textContent =
            `canvasFPS: ${(draws/dt).toFixed(1)}\n` +
            `rVFC/s:    ${(vfcCalls/dt).toFixed(1)}\n` +
            `framesDecoded: ${framesDecoded}`;
          draws = 0; vfcCalls = 0; lastT = now;
        }, 1000);

        // Resize canvas when the element size changes
        const resizeToVideo = () => {
          const w = remoteVideo.videoWidth, h = remoteVideo.videoHeight;
          if (w && h && (canvas.width !== w || canvas.height !== h)) {
            canvas.width = w; canvas.height = h;
          }
        };
        remoteVideo.addEventListener('resize', resizeToVideo);
        resizeToVideo();

        // --- RENDERERS ---
        let pumping = false;
        let intervalId = null;

        const onFrame = () => {
          vfcCalls++;
          if (!pumping) return;

          resizeToVideo();
          const w = canvas.width, h = canvas.height;
          if (w && h) {
            try {
              ctx.drawImage(remoteVideo, 0, 0, w, h);
              draws++;
            } catch (e) {
              console.warn('[canvas] drawImage error', e);
            }
          }
          if (remoteVideo.requestVideoFrameCallback) {
            remoteVideo.requestVideoFrameCallback(onFrame);
          } else {
            requestAnimationFrame(onFrame);
          }
        };

        const startRVFC = () => {
          if (intervalId) { clearInterval(intervalId); intervalId = null; }
          if (pumping) return;
          pumping = true;
          if (remoteVideo.requestVideoFrameCallback) remoteVideo.requestVideoFrameCallback(onFrame);
          else requestAnimationFrame(onFrame);
        };

        const startIntervalRenderer = () => {
          if (intervalId) return;
          pumping = false;
          intervalId = setInterval(() => {
            resizeToVideo();
            const w = canvas.width, h = canvas.height;
            if (!w || !h) return;
            try { ctx.drawImage(remoteVideo, 0, 0, w, h); draws++; } catch (e) {
              console.warn('[canvas] interval draw error', e);
            }
          }, 33); // ~30 fps
        };

        // Re-arm rVFC after tab becomes visible (some browsers drop the chain)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && pumping && remoteVideo.requestVideoFrameCallback) {
            remoteVideo.requestVideoFrameCallback(onFrame);
          }
        });

        // Small button bar to switch renderers live
        const bar = document.createElement('div');
        bar.style.cssText = 'position:absolute;left:8px;top:8px;z-index:9999;display:flex;gap:6px';
        bar.innerHTML = `
          <button id="btn-rvfc">rVFC</button>
          <button id="btn-intv">setInterval</button>
          <button id="btn-both">both</button>
        `;
        document.body.appendChild(bar);
        document.getElementById('btn-rvFC')?.remove(); // avoid dup if hot-reloading
        document.getElementById('btn-rvfc').onclick  = () => { pumping = false; if (intervalId) { clearInterval(intervalId); intervalId = null; } startRVFC(); };
        document.getElementById('btn-intv').onclick  = () => { if (intervalId) return; startIntervalRenderer(); };
        document.getElementById('btn-both').onclick  = () => { if (!intervalId) startIntervalRenderer(); pumping = false; startRVFC(); };

        // Start with rVFC
        startRVFC();

        // Cleanup if the track ends
        e.track.addEventListener('ended', () => {
          pumping = false;
          if (intervalId) clearInterval(intervalId);
          clearInterval(statsTimer);
          clearInterval(overlayTimer);
          overlay.remove();
          bar.remove();
        });
      };


      startWhenReady();
    };

    // 6) Offer
    const offer = await viewerPc.createOffer();
    await viewerPc.setLocalDescription(offer);
    sig.send(to, 'sdp-offer', offer);
  };

  // 7) Answer
  sig.on('sdp-answer', async (_, answer) => {
    if (!viewerPc) return;
    await viewerPc.setRemoteDescription(new RTCSessionDescription(answer));
    for (const c of pendingCandidates) {
      await viewerPc.addIceCandidate(new RTCIceCandidate(c));
    }
    pendingCandidates.length = 0;
  });

  // 8) ICE from streamer
  sig.on('ice-candidate', async (_, candidate) => {
    if (!viewerPc) return;
    if (viewerPc.remoteDescription && viewerPc.remoteDescription.type) {
      await viewerPc.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      pendingCandidates.push(candidate);
    }
  });

  // 9) Renegotiation from streamer
  sig.on('sdp-offer', async (from, offer) => {
    if (!viewerPc) return;
    try {
      await viewerPc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await viewerPc.createAnswer();
      await viewerPc.setLocalDescription(answer);
      sig.send(from, 'sdp-answer', answer);
    } catch (err) {
      console.error('[Viewer] Renegotiation failed:', err);
    }
  });
}
