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
const blockBtn        = document.getElementById('block-btn');
const deleteAccountBtn = document.getElementById('delete-account-btn');
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
const camBtn            = document.getElementById('cam-btn');
const endCallBtn        = document.getElementById('end-call-btn');
const lightbox          = document.getElementById('lightbox');
const lightboxImg       = document.getElementById('lightbox-img');
const lightboxClose     = document.getElementById('lightbox-close');

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
let blockedList = []; // jinko maine block kiya hai

// WebRTC state
let peerConnection = null;
let localStream    = null;
let incomingOffer  = null;
let incomingFrom   = null;
let incomingCallType = 'voice';
let activeCallWith = null;
let isMuted        = false;
let isCamOff       = false;

// Ab ICE servers hardcode nahi — server se load hote hain (STUN + TURN).
// Fallback STUN-only rakha hai taaki agar /api/ice-servers fail ho jaye
// (network issue) to bhi same-network calls to chalte rahein.
let ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

async function loadIceServers() {
  try {
    const res = await fetch('/api/ice-servers');
    if (res.ok) {
      const data = await res.json();
      if (data.iceServers && data.iceServers.length) {
        ICE_SERVERS = { iceServers: data.iceServers };
      }
    }
  } catch {
    console.warn('ICE servers load nahi hue, sirf STUN fallback use hoga');
  }
}
await loadIceServers();

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
  Object.values(chatMessages).forEach(arr => {
    const m = arr.find(x => x.id === id);
    if (m) m.status = status;
  });
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
    if (type === 'received') socket.emit('mark-seen', { otherUser: other });
  } else {
    unread[other] = (unread[other] || 0) + 1;
    updateChatItemBadge(other, unread[other]);
  }
  updateChatItemLast(other, data.mediaUrl ? (data.mediaType === 'image' ? '📷 Photo' : '🎥 Video') : data.message);
  ensureUserInSidebar(other);
});

socket.on('messages-delivered', ({ ids }) => {
  (ids || []).forEach(id => updateMessageStatus(id, 'delivered'));
});

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
async function loadAllUsers() {
  try {
    const res = await fetch('/api/users');
    if (!res.ok) return;
    const allUsers = await res.json();
    allUsers.forEach(name => ensureUserInSidebar(name));
  } catch {}
}
loadAllUsers();

// ===================== BLOCK / UNBLOCK =====================
async function loadBlockedList() {
  try {
    const res = await fetch('/api/blocked');
    if (!res.ok) return;
    blockedList = await res.json();
  } catch {}
}
loadBlockedList();

function isBlocked(name) { return blockedList.includes(name); }

function updateBlockUI() {
  if (currentChat === 'group') {
    blockBtn.classList.add('hidden');
    msgInput.disabled = false;
    msgInput.placeholder = 'Message';
    sendBtn.disabled = false;
    mediaLabel.style.pointerEvents = '';
    mediaLabel.style.opacity = '';
    const existingBanner = document.getElementById('blocked-banner');
    if (existingBanner) existingBanner.remove();
    return;
  }
  blockBtn.classList.remove('hidden');
  const blocked = isBlocked(currentChat);
  blockBtn.title = blocked ? `Unblock ${currentChat}` : `Block ${currentChat}`;
  blockBtn.classList.toggle('blocked-active', blocked);

  msgInput.disabled = blocked;
  msgInput.placeholder = blocked ? 'Aapne is user ko block kiya hai' : 'Message';
  sendBtn.disabled = blocked;
  mediaLabel.style.pointerEvents = blocked ? 'none' : '';
  mediaLabel.style.opacity = blocked ? '0.4' : '';
  voiceCallBtn.style.pointerEvents = blocked ? 'none' : '';
  voiceCallBtn.style.opacity = blocked ? '0.4' : '';
  videoCallBtn.style.pointerEvents = blocked ? 'none' : '';
  videoCallBtn.style.opacity = blocked ? '0.4' : '';

  const existingBanner = document.getElementById('blocked-banner');
  if (existingBanner) existingBanner.remove();
  if (blocked) {
    const banner = document.createElement('div');
    banner.className = 'system-msg';
    banner.id = 'blocked-banner';
    banner.textContent = `🚫 Aapne ${currentChat} ko block kiya hai — messages aana-jaana band hai`;
    messagesEl.appendChild(banner);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

blockBtn.addEventListener('click', async () => {
  if (currentChat === 'group') return;
  const target = currentChat;
  const alreadyBlocked = isBlocked(target);
  const endpoint = alreadyBlocked ? '/api/unblock' : '/api/block';
  if (!alreadyBlocked && !confirm(`Kya aap ${target} ko block karna chahte ho? Aap ek-doosre ko msg/call nahi kar paoge.`)) return;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: target })
    });
    if (!res.ok) return;
    if (alreadyBlocked) blockedList = blockedList.filter(n => n !== target);
    else blockedList.push(target);
    updateBlockUI();
  } catch {}
});

function renderOnlineUsers(users) {
  document.querySelectorAll('#online-list .chat-item').forEach(el => {
    const dot = el.querySelector('.online-dot');
    if (dot) dot.style.display = 'none';
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

  messagesEl.innerHTML = chatKey === 'group'
    ? '<div class="system-msg">🔒 Messages are end-to-end encrypted</div>'
    : `<div class="system-msg">🔒 Private chat with ${chatKey}</div>`;

  if (chatKey !== 'group' && (!chatMessages[chatKey] || chatMessages[chatKey].length === 0)) {
    await loadHistory(chatKey);
  }

  lastSender = null;
  lastDateLabel = null;
  (chatMessages[chatKey] || []).forEach(m => renderMessage(m));

  if (chatKey !== 'group') {
    socket.emit('mark-seen', { otherUser: chatKey });
  }

  updateBlockUI();

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
      status: m.status || 'read',
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

  camBtn.style.display = callType === 'video' ? '' : 'none';
  localVideo.style.display = callType === 'video' ? '' : 'none';
}

function showCallScreen(callType, name, status) {
  callScreenName.textContent = name;
  callScreenStatus.textContent = status;
  remoteVideo.style.display = callType === 'video' ? '' : 'none';
  callScreen.classList.remove('hidden');
}

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

rejectCallBtn.addEventListener('click', () => {
  socket.emit('call-reject', { to: incomingFrom });
  incomingModal.classList.add('hidden');
});

endCallBtn.addEventListener('click', () => {
  socket.emit('call-end', { to: activeCallWith });
  appendSystem('📵 Call khatam kiya');
  cleanupCall();
});

muteBtn.addEventListener('click', () => {
  isMuted = !isMuted;
  if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  muteBtn.classList.toggle('ctrl-active', isMuted);
  muteBtn.title = isMuted ? 'Unmute' : 'Mute';
});

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

// ===================== DELETE ACCOUNT =====================
deleteAccountBtn.addEventListener('click', async () => {
  const sure = confirm('Kya aap sach mein apna account delete karna chahte ho? Aapke saare messages bhi hamesha ke liye delete ho jayenge. Ye action wapas nahi ho sakta.');
  if (!sure) return;
  const doubleSure = confirm('Pakka? Ye final warning hai — account aur data permanently delete ho jayega.');
  if (!doubleSure) return;
  try {
    const res = await fetch('/api/account', { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Delete failed'); return; }
    socket.disconnect();
    window.location.href = '/';
  } catch {
    alert('Network error, dubara try karo');
  }
});

socket.on('force-logout', () => {
  socket.disconnect();
  window.location.href = '/';
});

socket.on('user-removed', ({ name }) => {
  const item = document.getElementById('chat-item-' + name);
  if (item) item.remove();
  blockedList = blockedList.filter(n => n !== name);
  if (currentChat === name) {
    appendSystem(`${name} ne apna account delete kar diya hai`);
    openChat('group');
  }
});

socket.on('message-deleted', ({ id, from, to }) => {
  const other = from === username ? to : from;
  if (chatMessages[other]) {
    chatMessages[other] = chatMessages[other].filter(m => m.id !== id);
  }
  const bubble = document.querySelector(`.msg-bubble[data-msg-id="${id}"]`);
  if (bubble) {
    const wrap = bubble.closest('.msg');
    if (wrap) wrap.remove();
  }
});

// ===================== RENDER MESSAGES =====================
function timeStr(date) {
  date = date || new Date();
  let h = date.getHours();
  let m = date.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  m = m < 10 ? '0' + m : m;
  return `${h}:${m} ${ampm}`;
}

function getDateLabel(date) {
  const d = new Date(date || new Date());
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

function insertDateDivider(label) {
  const div = document.createElement('div');
  div.className = 'date-divider';
  div.innerHTML = `<span>${label.toUpperCase()}</span>`;
  messagesEl.appendChild(div);
}

let lastSender = null;
let lastDateLabel = null;

async function deleteMessage(id) {
  if (!id) return;
  if (!confirm('Ye message sabke liye delete kar du?')) return;
  try {
    const res = await fetch(`/api/message/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Delete nahi ho paya');
      return;
    }
    Object.values(chatMessages).forEach(arr => {
      const idx = arr.findIndex(m => m.id === id);
      if (idx !== -1) arr.splice(idx, 1);
    });
    const bubble = document.querySelector(`.msg-bubble[data-msg-id="${id}"]`);
    if (bubble) {
      const wrap = bubble.closest('.msg');
      if (wrap) wrap.remove();
    }
  } catch {
    alert('Network error, dubara try karo');
  }
}

function buildDeleteBtn(id) {
  const btn = document.createElement('button');
  btn.className = 'msg-delete-btn';
  btn.title = 'Delete message';
  btn.type = 'button';
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 7h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7zm3-3h6l1 2h4v2H4V6h4l1-2z"/></svg>`;
  btn.addEventListener('click', (e) => { e.stopPropagation(); deleteMessage(id); });
  return btn;
}

function renderMessage(m) {
  const label = getDateLabel(m.createdAt);
  if (label !== lastDateLabel) {
    insertDateDivider(label);
    lastDateLabel = label;
    lastSender = null;
  }
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
    if (id) bubble.appendChild(buildDeleteBtn(id));
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
    if (id) bubble.appendChild(buildDeleteBtn(id));
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