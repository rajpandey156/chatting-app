document.addEventListener('DOMContentLoaded', async () => {

// ===================== ELEMENTS =====================
const headerName  = document.getElementById('header-name');
const headerAvatar= document.getElementById('header-avatar');
const messagesEl  = document.getElementById('messages');
const msgInput    = document.getElementById('msg-input');
const sendBtn     = document.getElementById('send-btn');
const logoutBtn   = document.getElementById('logout-btn');
const emojiBtn    = document.getElementById('emoji-btn');
const emojiPanel  = document.getElementById('emoji-panel');

// ===================== AUTH CHECK =====================
let username = '';
try {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }
  const data = await res.json();
  username = data.name;
} catch {
  window.location.href = '/';
  return;
}

// Set header
headerName.textContent = 'Group Chat';

// ===================== COLORS =====================
const nameColors = [
  '#e53935','#d81b60','#8e24aa','#5e35b1',
  '#1e88e5','#00897b','#43a047','#f4511e',
  '#6d4c41','#00acc1'
];
const colorMap = {};

function getColor(name) {
  if (!colorMap[name]) {
    const idx = Object.keys(colorMap).length % nameColors.length;
    colorMap[name] = nameColors[idx];
  }
  return colorMap[name];
}

// ===================== SOCKET =====================
// Cookie automatically sent — Socket.io will pick it up via handshake
const socket = io();

socket.on('connect', () => {
  console.log('Connected as', username);
});

socket.on('message', (data) => {
  const type = data.name === username ? 'sent' : 'received';
  appendMessage(data.name, data.message, type);
});

socket.on('system', (msg) => {
  appendSystem(msg);
});

socket.on('connect_error', (err) => {
  appendSystem('⚠️ Connection error: ' + err.message);
});

// ===================== SEND =====================
function sendMessage() {
  const msg = msgInput.value.trim();
  if (!msg) return;
  socket.emit('user-message', { message: msg });
  msgInput.value = '';
  msgInput.focus();
  emojiPanel.classList.remove('open');
}

// ===================== LOGOUT =====================
logoutBtn.addEventListener('click', async () => {
  socket.disconnect();
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

// ===================== HELPERS =====================
function timeStr() {
  return new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}

let lastSender = null;

function appendMessage(name, text, type) {
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
  bubble.textContent = text;

  const meta = document.createElement('div');
  meta.className = 'msg-meta';

  const timeEl = document.createElement('span');
  timeEl.className = 'msg-time';
  timeEl.textContent = timeStr();
  meta.appendChild(timeEl);

  if (type === 'sent') {
    const tick = document.createElement('span');
    tick.className = 'tick read';
    tick.innerHTML = `
      <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor">
        <path d="M11.071.653a.75.75 0 0 1 .205 1.04l-5.5 8a.75.75 0 0 1-1.153.114l-3-3a.75.75 0 0 1 1.06-1.06l2.4 2.4 4.948-7.19a.75.75 0 0 1 1.04-.304z"/>
        <path d="M14.571.653a.75.75 0 0 1 .205 1.04l-5.5 8a.75.75 0 0 1-1.153.114L6.573 8.26a.75.75 0 0 1 1.06-1.06l1.4 1.4 4.498-6.542a.75.75 0 0 1 1.04-.305z" opacity="0.7"/>
      </svg>`;
    meta.appendChild(tick);
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

// ===================== EMOJI =====================
emojiBtn.addEventListener('click', () => {
  emojiPanel.classList.toggle('open');
});

document.querySelectorAll('.emoji-panel span').forEach(span => {
  span.addEventListener('click', () => {
    msgInput.value += span.textContent;
    msgInput.focus();
  });
});

document.addEventListener('click', (e) => {
  if (!emojiPanel.contains(e.target) && e.target !== emojiBtn) {
    emojiPanel.classList.remove('open');
  }
});

// ===================== EVENTS =====================
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });
msgInput.focus();

}); // DOMContentLoaded end