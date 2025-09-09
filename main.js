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
let localStreams = [];                // Array<MediaStream> for the 3 fake videos
const remoteStream = new MediaStream();

const pcs = {};                       // streamer: viewerId → RTCPeerConnection
let viewerPc = null;                  // viewer’s RTCPeerConnection
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

  if (role === 'streamer') {
    sc.style.display = 'block';
    vc.style.display = 'none';
    setupStreamer();
  } else {
    sc.style.display = 'none';
    vc.style.display = 'block';
    setupViewer();
  }
};

// —————— STREAMER Flow ——————
// —————— STREAMER Flow ——————
function setupStreamer() {
  // 1) Load & preview all 3 streams
  document.getElementById('startStream').onclick = async () => {
    localStreams = await streamFromMultipleUrls(urls);
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
  };

  // 2) Answer each viewer’s offer on its own PC
  sig.on('sdp-offer', async (from, offer) => {
    if (role !== 'streamer' || localStreams.length === 0) return;
    if (!pcs[from]) {
      const pc = new RTCPeerConnection(iceConfig);
      const track0 = localStreams[0].getVideoTracks()[0];
      pc.addTrack(track0, localStreams[0]);

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
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sig.send(from, 'sdp-answer', answer);
  });

  sig.on('ice-candidate', async (from, candidate) => {
    if (role !== 'streamer') return;
    const pc = pcs[from];
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
  });
}


// —————— VIEWER Flow ——————
function setupViewer() {
  // Bind remote stream to the <video>
  const remoteVideo = document.getElementById('remoteVideo');
  remoteVideo.srcObject = remoteStream;
  document.getElementById('streamSelect').disabled = true;

  // Buffer ICE candidates that arrive too early
  const pendingCandidates = [];

  // Stream selection (sends index over DataChannel)
  document.getElementById('streamSelect').onchange = e => {
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(e.target.value);
    }
  };

  // “Connect & Watch” click handler
  document.getElementById('connectBtn').onclick = async () => {
    const to = document.getElementById('streamerIdInput').value.trim();
    if (!to) return alert('Please enter the Streamer ID');

    // 1) Create PeerConnection
    viewerPc = new RTCPeerConnection(iceConfig);

    // 2) Ask for recv-only video
    viewerPc.addTransceiver('video', { direction: 'recvonly' });

    // 3) DataChannel for switch commands
    dataChannel = viewerPc.createDataChannel('chat');
    dataChannel.onopen = () => {
      console.log('Chat open');
      document.getElementById('streamSelect').disabled = false;
    };
    dataChannel.onmessage = e => console.log('Message from streamer:', e.data);

    // 4) Forward ICE to streamer
    viewerPc.onicecandidate = e => {
      if (e.candidate) {
        sig.send(to, 'ice-candidate', e.candidate.toJSON());
      }
    };

    // 5) Handle incoming track
    viewerPc.ontrack = e => {
      // clear old video tracks
      remoteStream.getVideoTracks().forEach(t => remoteStream.removeTrack(t));
      remoteStream.addTrack(e.track);
    };

    // 6) Create & send offer
    const offer = await viewerPc.createOffer();
    await viewerPc.setLocalDescription(offer);
    sig.send(to, 'sdp-offer', offer);
  };

  // 7) Handle answer, then flush ICE buffer
  sig.on('sdp-answer', async (_, answer) => {
    if (!viewerPc) return;
    await viewerPc.setRemoteDescription(new RTCSessionDescription(answer));
    for (const c of pendingCandidates) {
      await viewerPc.addIceCandidate(new RTCIceCandidate(c));
    }
    pendingCandidates.length = 0;
  });

  // 8) Route ICE from streamer (buffer if needed)
  sig.on('ice-candidate', async (_, candidate) => {
    if (!viewerPc) return;
    if (viewerPc.remoteDescription && viewerPc.remoteDescription.type) {
      await viewerPc.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      pendingCandidates.push(candidate);
    }
  });
}
