document.addEventListener('DOMContentLoaded', async () => {

// ===================== ELEMENTS =====================
const headerName     = document.getElementById('header-name');
const headerAvatar   = document.getElementById('header-avatar');
const messagesEl     = document.getElementById('messages');
const msgInput       = document.getElementById('msg-input');
const sendBtn        = document.getElementById('send-btn');
const logoutBtn      = document.getElementById('logout-btn');
const emojiBtn       = document.getElementById('emoji-btn');
const emojiPanel     = document.getElementById('emoji-panel');
const onlineListEl   = document.getElementById('online-list');
const onlineCountEl  = document.getElementById('online-count');
const sidebarMyName  = document.getElementById('sidebar-my-name');
const menuToggle     = document.getElementById('menu-toggle');
const sidebar        = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const groupChatItem  = document.getElementById('group-chat-item');
const mediaInput     = document.getElementById('media-input');
const mediaLabel     = document.getElementById('media-label');
const voiceCallBtn   = document.getElementById('voice-call-btn');
const videoCallBtn   = document.getElementById('video-call-btn');
// Call UI
const incomingModal    = document.getElementById('incoming-call-modal');
const callAvatarIn     = document.getElementById('call-avatar-incoming');
const callNameIn       = document.getElementById('call-name-incoming');
const callTypeLabel    = document.getElementById('call-type-label');
const acceptCallBtn    = document.getElementById('accept-call-btn');
const rejectCallBtn    = document.getElementById('reject-call-btn');
const callScreen       = document.getElementById('call-screen');
const remoteVideo      = document.getElementById('remote-video');
const localVideo       = document.getElementById('local-video');
const callScreenName   = document.getElementById('call-screen-name');
const callScreenStatus = document.getElementById('call-screen-status');
const muteBtn          = document.getElementById('mute-btn');
const camBtn           = document.getElementById('cam-btn');
const endCallBtn       = document.getElementById('end-call-btn');
const lightbox         = document.getElementById('lightbox');
const lightboxImg      = document.getElementById('lightbox-img');
const lightboxClose    = document.getElementById('lightbox-close');

// ===================== AUTH =====================
let username = '';
try {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }
  const data = await res.json();
  username = data.name;
} catch { window.location.href = '/'; return; }

sidebarMyName.textContent = username;

// ===================== STATE =====================
let currentChat = 'group';
const chatMessages = { group: [] };
const unread = {};

// WebRTC state
let peerConnection = null;
let localStream    = null;
let incomingOffer  = null;
let incomingFrom   = null;
let incomingCallType = 'voice';
let activeCallWith = null;
let isMuted        = false;
let isCamOff       = false;

const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// ===================== COLORS =====================
const nameColors = ['#e53935','#d81b60','#8e24aa','#5e35b1','#1e88e5','#00897b','#43a047','#f4511e','#6d4c41','#00acc1'];
const colorMap = {};
function getColor(name) {
  if (!colorMap[name]) colorMap[name] = nameColors[Object.keys(colorMap).length % nameColors.length];
  return colorMap[name];
}
function getInitial(name) { return name ? name[0].toUpperCase() : '?'; }

// ===================== TICK ICONS =====================
const SINGLE_TICK_SVG = `<svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor"><path d="M11.071.653a.75.75 0 0 1 .205 1.04l-5.5 8a.75.75 0 0 1-1.153.114l-3-3a.75.75 0 0 1 1.06-1.06l2.4 2.4 4.948-7.19a.75.75 0 0 1 1.04-.304z"/></svg>`;
const DOUBLE_TICK_SVG = `<svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor"><path d="M11.071.653a.75.75 0 0 1 .205 1.04l-5.5 8a.75.75 0 0 1-1.153.114l-3-3a.75.75 0 0 1 1.06-1.06l2.4 2.4 4.948-7.19a.75.75 0 0 1 1.04-.304z"/><path d="M14.571.653a.75.75 0 0 1 .205 1.04l-5.5 8a.75.75 0 0 1-1.153.114L6.573 8.26a.75.75 0 0 1 1.06-1.06l1.4 1.4 4.498-6.542a.75.75 0 0 1 1.04-.305z" opacity="0.7"/></svg>`;

// status: 'sent' -> single grey tick (recipient ka net off / offline tha)
//         'delivered' -> double grey tick (recipient online hai / ho gaya)
//         'read' -> double blue tick (recipient ne dekh liya)
function buildTickNode(status) {
  const span = document.createElement('span');
  if (status === 'read') {
    span.className = 'tick read';
    span.innerHTML = DOUBLE_TICK_SVG;
  } else if (status === 'delivered') {
    span.className = 'tick';
    span.innerHTML = DOUBLE_TICK_SVG;
  } else {
    span.className = 'tick';
    span.innerHTML = SINGLE_TICK_SVG;
  }
  return span;
}

function updateMessageStatus(id, status) {
  if (!id) return;
  // in-memory store update (taaki re-render pe bhi sahi tick dikhe)
  Object.values(chatMessages).forEach(arr => {
    const m = arr.find(x => x.id === id);
    if (m) m.status = status;
  });
  // live DOM update
  const bubble = document.querySelector(`.msg-bubble[data-msg-id="${id}"]`);
  if (!bubble) return;
  const oldTick = bubble.querySelector('.tick');
  if (oldTick) oldTick.replaceWith(buildTickNode(status));
}

// ===================== SOCKET =====================
const socket = io();

socket.on('connect', () => console.log('Connected as', username));

socket.on('message', (data) => {
  const msg = { name: data.name, message: data.message, type: data.name === username ? 'sent' : 'received', createdAt: new Date() };
  chatMessages['group'].push(msg);
  if (currentChat === 'group') renderMessage(msg);
  else { unread['group'] = (unread['group'] || 0) + 1; updateChatItemBadge('group', unread['group']); }
  updateChatItemLast('group', data.message);
});

socket.on('private-message', (data) => {
  const other = data.from === username ? data.to : data.from;
  const type  = data.from === username ? 'sent' : 'received';
  const msg   = {
    id: data.id,
    name: data.from,
    message: data.message,
    type,
    mediaUrl: data.mediaUrl,
    mediaType: data.mediaType,
    status: data.status || 'sent',
    createdAt: new Date(data.createdAt)
  };
  if (!chatMessages[other]) chatMessages[other] = [];
  chatMessages[other].push(msg);

  if (currentChat === other) {
    renderMessage(msg);
    // Main chat already khula hai, matlab abhi ke abhi dekh liya -> seen mark karo
    if (type === 'received') socket.emit('mark-seen', { otherUser: other });
  } else {
    unread[other] = (unread[other] || 0) + 1;
    updateChatItemBadge(other, unread[other]);
  }
  updateChatItemLast(other, data.mediaUrl ? (data.mediaType === 'image' ? '📷 Photo' : '🎥 Video') : data.message);
  ensureUserInSidebar(other);
});

// Recipient ka net wapas ON hua -> hamare bheje single-tick messages double-tick ho jaayenge
socket.on('messages-delivered', ({ ids }) => {
  (ids || []).forEach(id => updateMessageStatus(id, 'delivered'));
});

// Recipient ne chat khol kar dekh liya -> double blue tick
socket.on('messages-seen', ({ ids }) => {
  (ids || []).forEach(id => updateMessageStatus(id, 'read'));
});

socket.on('private-message-info', ({ note }) => { /* optional: subtle info, UI clutter avoid karne ke liye silent rakha */ });

socket.on('system', (msg) => { if (currentChat === 'group') appendSystem(msg); });
socket.on('online-users', (users) => {
  renderOnlineUsers(users);
  onlineCountEl.textContent = users.length + ' online';
});
socket.on('connect_error', (err) => { if (currentChat === 'group') appendSystem('⚠️ ' + err.message); });

// ── WebRTC Socket Events ──────────────────────────────────────────────────────
socket.on('incoming-call', ({ from, offer, callType }) => {
  incomingFrom    = from;
  incomingOffer   = offer;
  incomingCallType = callType;
  callAvatarIn.textContent = getInitial(from);
  callAvatarIn.style.background = getColor(from);
  callNameIn.textContent = from;
  callTypeLabel.textContent = callType === 'video' ? '📹 Video Call' : '📞 Voice Call';
  incomingModal.classList.remove('hidden');
});

socket.on('call-answered', async ({ answer }) => {
  if (!peerConnection) return;
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  callScreenStatus.textContent = 'Connected';
});

socket.on('ice-candidate', async ({ candidate }) => {
  if (peerConnection && candidate) {
    try { await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
  }
});

socket.on('call-rejected', () => {
  appendSystem(`📵 ${activeCallWith} ne call reject kiya`);
  cleanupCall();
});

socket.on('call-ended', () => {
  appendSystem(`📵 Call khatam hua`);
  cleanupCall();
});

socket.on('call-failed', ({ reason }) => {
  appendSystem('⚠️ ' + reason);
  cleanupCall();
});

// ===================== SIDEBAR =====================
function renderOnlineUsers(users) {
  // Remove users who went offline (keep elements for known chats)
  document.querySelectorAll('#online-list .chat-item').forEach(el => {
    const name = el.dataset.chat;
    if (!users.includes(name)) {
      const dot = el.querySelector('.online-dot');
      if (dot) dot.style.display = 'none';
    }
  });
  users.forEach(name => {
    if (name === username) return;
    ensureUserInSidebar(name);
    const dot = document.querySelector(`#chat-item-${CSS.escape(name)} .online-dot`);
    if (dot) dot.style.display = 'inline-block';
  });
}

function ensureUserInSidebar(name) {
  if (document.getElementById('chat-item-' + name)) return;
  const div = document.createElement('div');
  div.className = 'chat-item';
  div.id = 'chat-item-' + name;
  div.dataset.chat = name;
  div.innerHTML = `
    <div class="chat-item-avatar user-avatar" style="background:${getColor(name)}">${getInitial(name)}</div>
    <div class="chat-item-info">
      <div class="chat-item-name">${name} <span class="online-dot" style="display:none"></span></div>
      <div class="chat-item-last" id="last-${name}">Click to chat</div>
    </div>
    <div class="badge hidden" id="badge-${name}"></div>`;
  div.addEventListener('click', () => openChat(name));
  onlineListEl.appendChild(div);
}

function updateChatItemLast(chatKey, message) {
  const el = document.getElementById('last-' + chatKey);
  if (el) el.textContent = message.length > 28 ? message.slice(0, 28) + '…' : message;
}

function updateChatItemBadge(chatKey, count) {
  const badge = document.getElementById('badge-' + chatKey);
  if (!badge) return;
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);
}

// ===================== OPEN CHAT =====================
async function openChat(chatKey) {
  currentChat = chatKey;
  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
  const activeEl = chatKey === 'group' ? groupChatItem : document.getElementById('chat-item-' + chatKey);
  if (activeEl) activeEl.classList.add('active');

  unread[chatKey] = 0;
  updateChatItemBadge(chatKey, 0);

  // Header
  if (chatKey === 'group') {
    headerName.textContent = 'Group Chat';
    headerAvatar.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="#075e54"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>`;
    headerAvatar.style.background = '#dfe5e7';
    headerAvatar.style.fontSize = '';
    document.querySelectorAll('.call-btn').forEach(b => b.classList.add('hidden'));
  } else {
    headerName.textContent = chatKey;
    headerAvatar.textContent = getInitial(chatKey);
    headerAvatar.style.background = getColor(chatKey);
    headerAvatar.style.color = '#fff';
    headerAvatar.style.fontSize = '18px';
    headerAvatar.style.fontWeight = '700';
    document.querySelectorAll('.call-btn').forEach(b => b.classList.remove('hidden'));
  }

  messagesEl.innerHTML = '<div class="date-divider"><span>TODAY</span></div>';
  messagesEl.innerHTML += chatKey === 'group'
    ? '<div class="system-msg">🔒 Messages are end-to-end encrypted</div>'
    : `<div class="system-msg">🔒 Private chat with ${chatKey}</div>`;

  if (chatKey !== 'group' && (!chatMessages[chatKey] || chatMessages[chatKey].length === 0)) {
    await loadHistory(chatKey);
  }

  lastSender = null;
  (chatMessages[chatKey] || []).forEach(m => renderMessage(m));

  // Chat khola -> doosre user ke bheje hue saare unseen messages "read" mark karo
  if (chatKey !== 'group') {
    socket.emit('mark-seen', { otherUser: chatKey });
  }

  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('show');
  msgInput.focus();
}

async function loadHistory(otherUser) {
  try {
    const res  = await fetch(`/api/history/${encodeURIComponent(otherUser)}`);
    if (!res.ok) return;
    const msgs = await res.json();
    chatMessages[otherUser] = msgs.map(m => ({
      id: m._id,
      name: m.from, message: m.message || '',
      mediaUrl: m.mediaUrl, mediaType: m.mediaType,
      type: m.from === username ? 'sent' : 'received',
      status: m.status || 'read', // purane messages (status field se pehle ke) ko read maan lo
      createdAt: new Date(m.createdAt)
    }));
  } catch {}
}

groupChatItem.addEventListener('click', () => openChat('group'));

// ===================== SEND TEXT =====================
function sendMessage() {
  const msg = msgInput.value.trim();
  if (!msg) return;
  if (currentChat === 'group') socket.emit('user-message', { message: msg });
  else socket.emit('private-message', { to: currentChat, message: msg });
  msgInput.value = '';
  msgInput.focus();
  emojiPanel.classList.remove('open');
}

// ===================== SEND MEDIA =====================
mediaInput.addEventListener('change', async () => {
  const file = mediaInput.files[0];
  if (!file || currentChat === 'group') {
    if (currentChat === 'group') appendSystem('⚠️ Group mein abhi media support nahi hai');
    mediaInput.value = '';
    return;
  }

  const formData = new FormData();
  formData.append('media', file);
  formData.append('to', currentChat);

  appendSystem('⏳ Uploading...');

  try {
    const res  = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) { appendSystem('❌ Upload failed: ' + data.error); return; }
    socket.emit('private-media', { to: currentChat, mediaUrl: data.mediaUrl, mediaType: data.mediaType, id: data.id, status: data.status });
    // Remove "Uploading..." system msg
    const uploading = [...messagesEl.querySelectorAll('.system-msg')].find(el => el.textContent === '⏳ Uploading...');
    if (uploading) uploading.remove();
  } catch (e) {
    appendSystem('❌ Upload error');
  }
  mediaInput.value = '';
});

// ===================== WEBRTC CALL =====================
async function startCall(callType) {
  if (!currentChat || currentChat === 'group') return;
  activeCallWith = currentChat;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callType === 'video'
    });
  } catch {
    appendSystem('❌ Mic/Camera access nahi mila');
    return;
  }

  setupPeerConnection(callType);
  localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

  if (callType === 'video') localVideo.srcObject = localStream;

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit('call-user', { to: activeCallWith, offer, callType });

  showCallScreen(callType, activeCallWith, 'Ringing...');
}

function setupPeerConnection(callType) {
  peerConnection = new RTCPeerConnection(ICE_SERVERS);

  peerConnection.onicecandidate = (e) => {
    if (e.candidate) socket.emit('ice-candidate', { to: activeCallWith || incomingFrom, candidate: e.candidate });
  };

  peerConnection.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
  };

  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === 'connected') callScreenStatus.textContent = 'Connected ✅';
    if (['disconnected','failed','closed'].includes(peerConnection.connectionState)) cleanupCall();
  };

  // Hide cam button for voice call
  camBtn.style.display = callType === 'video' ? '' : 'none';
  localVideo.style.display = callType === 'video' ? '' : 'none';
}

function showCallScreen(callType, name, status) {
  callScreenName.textContent = name;
  callScreenStatus.textContent = status;
  remoteVideo.style.display = callType === 'video' ? '' : 'none';
  callScreen.classList.remove('hidden');
}

// Accept incoming call
acceptCallBtn.addEventListener('click', async () => {
  incomingModal.classList.add('hidden');
  activeCallWith = incomingFrom;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: incomingCallType === 'video'
    });
  } catch {
    appendSystem('❌ Mic/Camera access nahi mila');
    socket.emit('call-reject', { to: incomingFrom });
    return;
  }

  setupPeerConnection(incomingCallType);
  localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
  if (incomingCallType === 'video') localVideo.srcObject = localStream;

  await peerConnection.setRemoteDescription(new RTCSessionDescription(incomingOffer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit('call-answer', { to: incomingFrom, answer });

  showCallScreen(incomingCallType, incomingFrom, 'Connecting...');
});

// Reject
rejectCallBtn.addEventListener('click', () => {
  socket.emit('call-reject', { to: incomingFrom });
  incomingModal.classList.add('hidden');
});

// End call
endCallBtn.addEventListener('click', () => {
  socket.emit('call-end', { to: activeCallWith });
  appendSystem('📵 Call khatam kiya');
  cleanupCall();
});

// Mute
muteBtn.addEventListener('click', () => {
  isMuted = !isMuted;
  if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  muteBtn.classList.toggle('ctrl-active', isMuted);
  muteBtn.title = isMuted ? 'Unmute' : 'Mute';
});

// Camera toggle
camBtn.addEventListener('click', () => {
  isCamOff = !isCamOff;
  if (localStream) localStream.getVideoTracks().forEach(t => t.enabled = !isCamOff);
  camBtn.classList.toggle('ctrl-active', isCamOff);
  camBtn.title = isCamOff ? 'Camera On' : 'Camera Off';
});

function cleanupCall() {
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  if (localStream)    { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  remoteVideo.srcObject = null;
  localVideo.srcObject  = null;
  callScreen.classList.add('hidden');
  incomingModal.classList.add('hidden');
  activeCallWith = null;
  incomingOffer  = null;
  incomingFrom   = null;
  isMuted = false;
  isCamOff = false;
}

voiceCallBtn.addEventListener('click', () => startCall('voice'));
videoCallBtn.addEventListener('click', () => startCall('video'));

// ===================== LOGOUT =====================
logoutBtn.addEventListener('click', async () => {
  socket.disconnect();
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

// ===================== RENDER MESSAGES =====================
function timeStr(date) {
  return (date || new Date()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

let lastSender = null;

function renderMessage(m) {
  if (m.mediaUrl) appendMedia(m.name, m.mediaUrl, m.mediaType, m.type, m.createdAt, m.id, m.status);
  else appendMessage(m.name, m.message, m.type, m.createdAt, m.id, m.status);
}

function appendMessage(name, text, type, date, id, status) {
  const div = document.createElement('div');
  div.className = 'msg ' + type;

  if (type === 'received' && name !== lastSender) {
    const nameEl = document.createElement('div');
    nameEl.className = 'msg-name';
    nameEl.style.color = getColor(name);
    nameEl.textContent = name;
    div.appendChild(nameEl);
  }

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (id) bubble.dataset.msgId = id;
  bubble.textContent = text;

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const timeEl = document.createElement('span');
  timeEl.className = 'msg-time';
  timeEl.textContent = timeStr(date);
  meta.appendChild(timeEl);

  if (type === 'sent') {
    meta.appendChild(buildTickNode(status || 'sent'));
  }

  bubble.appendChild(meta);
  div.appendChild(bubble);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  lastSender = name;
}

function appendMedia(name, mediaUrl, mediaType, type, date, id, status) {
  const div = document.createElement('div');
  div.className = 'msg ' + type;

  if (type === 'received' && name !== lastSender) {
    const nameEl = document.createElement('div');
    nameEl.className = 'msg-name';
    nameEl.style.color = getColor(name);
    nameEl.textContent = name;
    div.appendChild(nameEl);
  }

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble media-bubble';
  if (id) bubble.dataset.msgId = id;

  if (mediaType === 'image') {
    const img = document.createElement('img');
    img.src = mediaUrl;
    img.className = 'msg-img';
    img.addEventListener('click', () => openLightbox(mediaUrl));
    bubble.appendChild(img);
  } else {
    const vid = document.createElement('video');
    vid.src = mediaUrl;
    vid.className = 'msg-video';
    vid.controls = true;
    vid.preload = 'metadata';
    bubble.appendChild(vid);
  }

  const meta = document.createElement('div');
  meta.className = 'msg-meta media-meta';
  const timeEl = document.createElement('span');
  timeEl.className = 'msg-time';
  timeEl.textContent = timeStr(date);
  meta.appendChild(timeEl);
  if (type === 'sent') {
    meta.appendChild(buildTickNode(status || 'sent'));
  }
  bubble.appendChild(meta);
  div.appendChild(bubble);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  lastSender = name;
}

function appendSystem(msg) {
  lastSender = null;
  const div = document.createElement('div');
  div.className = 'system-msg';
  div.textContent = msg;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ===================== LIGHTBOX =====================
function openLightbox(src) {
  lightboxImg.src = src;
  lightbox.classList.remove('hidden');
}
lightboxClose.addEventListener('click', () => lightbox.classList.add('hidden'));
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.classList.add('hidden'); });

// ===================== EMOJI =====================
emojiBtn.addEventListener('click', () => emojiPanel.classList.toggle('open'));
document.querySelectorAll('.emoji-panel span').forEach(span => {
  span.addEventListener('click', () => { msgInput.value += span.textContent; msgInput.focus(); });
});
document.addEventListener('click', (e) => {
  if (!emojiPanel.contains(e.target) && e.target !== emojiBtn) emojiPanel.classList.remove('open');
});

// ===================== MOBILE SIDEBAR =====================
menuToggle.addEventListener('click', () => {
  sidebar.classList.toggle('open');
  sidebarOverlay.classList.toggle('show');
});
sidebarOverlay.addEventListener('click', () => {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('show');
});

// ===================== EVENTS =====================
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });
msgInput.focus();

});