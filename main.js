// main.js
import './style.css';
import { streamFromMultipleUrls, urls } from './fakeStreams.js';
import { Signaler } from './signalling.js';

// --- Signaling setup ---
const sig = new Signaler('ws://localhost:8080');
const pc  = new RTCPeerConnection({
  iceServers: [{ urls: ['stun:stun1.l.google.com:19302','stun:stun2.l.google.com:19302'] }],
  iceCandidatePoolSize: 10,
});

let dataChannel;
let localStream;
let remoteStream = new MediaStream();

// UI elements
const webcamButton  = document.getElementById('webcamButton');
const webcamVideo   = document.getElementById('webcamVideo');
const callInput     = document.getElementById('callInput');
const callButton    = document.getElementById('callButton');
const answerButton  = document.getElementById('answerButton');
const remoteVideo   = document.getElementById('remoteVideo');
const hangupButton  = document.getElementById('hangupButton');
const myIdDisplay    = document.getElementById('myIdDisplay');

// Display own peer ID
sig.on('welcome', (_, id) => {
  myIdDisplay.textContent = id;
});

// Incoming signaling handlers
sig.on('sdp-offer', async (from, offer) => {
  console.log('📥 Offer from', from, offer);
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sig.send(from, 'sdp-answer', answer);
});

sig.on('sdp-answer', async (_, answer) => {
  console.log('📥 Answer', answer);
  await pc.setRemoteDescription(new RTCSessionDescription(answer));
});

sig.on('ice-candidate', async (_, candidate) => {
  console.log('📥 ICE candidate', candidate);
  await pc.addIceCandidate(new RTCIceCandidate(candidate));
});

// DataChannel handler
pc.ondatachannel = ({ channel }) => {
  dataChannel = channel;
  dataChannel.onopen = () => console.log('🥳 DataChannel open!');
  dataChannel.onmessage = e => console.log('💬 Data:', e.data);
};

// Track handler
pc.ontrack = e => {
  e.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
};

// 1. Start webcam (or fake streams)
webcamButton.onclick = async () => {
  console.log("▶️ start webcam clicked");
  const fakeStreams = await streamFromMultipleUrls(urls);
  console.log("🔎 fakeStreams:", fakeStreams);
  console.log("🔎 tracks in stream[0]:", fakeStreams[0].getTracks());
  // swap real webcam for fake streams URLs
  localStream = fakeStreams[0];
  fakeStreams.forEach(stream => {
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
  });
  webcamVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;
  webcamButton.disabled = true;
  callButton.disabled   = false;
  answerButton.disabled = false;
};

// 2. Create offer (caller)
callButton.onclick = async () => {
  const to = callInput.value.trim();
  if (!to) return alert('Paste peer ID!');

  // setup DataChannel BEFORE offer
  dataChannel = pc.createDataChannel('chat');
  dataChannel.onopen = () => console.log('🥳 Chat open');
  dataChannel.onmessage = e => console.log('💬 Chat:', e.data);

  // gather ICE
  pc.onicecandidate = e => e.candidate && sig.send(to, 'ice-candidate', e.candidate.toJSON());

  // create & send offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sig.send(to, 'sdp-offer', offer);

  hangupButton.disabled = false;
};

// 3. Answer (callee)
answerButton.onclick = () => {
  const to = callInput.value.trim();
  if (!to) return alert('Paste peer ID!');

  pc.onicecandidate = e => e.candidate && sig.send(to, 'ice-candidate', e.candidate.toJSON());
  // actual SDP-offer handling is above in sig.on('sdp-offer')
  hangupButton.disabled = false;
};

// 4. Hangup
hangupButton.onclick = () => {
  pc.getSenders().forEach(s => s.track?.stop());
  pc.close();
  window.location.reload();
};
