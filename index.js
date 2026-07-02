require('dotenv').config();
const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const mongoose     = require('mongoose');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const path         = require('path');
const cookieParser = require('cookie-parser');
const multer       = require('multer');
const fs           = require('fs');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

const MONGO_URI  = process.env.MONGO_URI  || '';
const JWT_SECRET = process.env.JWT_SECRET || 'chatapp_secret_key_2024';
const PORT       = process.env.PORT       || 3000;

mongoose.connect(MONGO_URI, { family: 4 })
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ─── Schemas ─────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true, maxlength: 20 },
  email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:  { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const msgSchema = new mongoose.Schema({
  from:      { type: String, required: true },
  to:        { type: String, required: true },
  message:   { type: String, default: '' },
  mediaUrl:  { type: String, default: null },
  mediaType: { type: String, default: null }, // 'image' | 'video'
  // sent      -> receiver ka net off tha / offline tha
  // delivered -> receiver online ho gaya, message uske device tak pahuch gaya
  // read      -> receiver ne chat khol kar dekh liya
  status:    { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent' },
  createdAt: { type: Date, default: Date.now }
});
const PrivateMsg = mongoose.model('PrivateMsg', msgSchema);

// ─── Multer Setup ─────────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|webm|ogg|mov/;
    const ok = allowed.test(file.mimetype) && allowed.test(path.extname(file.originalname).toLowerCase());
    ok ? cb(null, true) : cb(new Error('Only images and videos allowed'));
  }
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function authMiddleware(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Login required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── Online users tracking (multi-socket safe) ─────────────────────────────────
// { userName: Set<socketId> }
const onlineUsers = {};

function addOnlineUser(name, socketId) {
  if (!onlineUsers[name]) onlineUsers[name] = new Set();
  onlineUsers[name].add(socketId);
}
function removeOnlineUser(name, socketId) {
  const set = onlineUsers[name];
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) delete onlineUsers[name];
}
function getSocketIds(name) {
  return onlineUsers[name] ? Array.from(onlineUsers[name]) : [];
}
function isOnline(name) {
  return getSocketIds(name).length > 0;
}
function emitToUser(name, event, payload) {
  const ids = getSocketIds(name);
  ids.forEach(id => io.to(id).emit(event, payload));
  return ids.length > 0;
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Sab fields bharo' });
  if (password.length < 6) return res.status(400).json({ error: 'Password 6+ characters ka hona chahiye' });
  try {
    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ error: 'Email already registered hai' });
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hash });
    const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, name: user.name });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email aur password bharo' });
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Email ya password galat hai' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Email ya password galat hai' });
    const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, name: user.name });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ name: req.user.name, email: req.user.email });
});

// ─── Media Upload ─────────────────────────────────────────────────────────────
app.post('/api/upload', authMiddleware, upload.single('media'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File nahi mili' });
    const mediaUrl  = '/uploads/' + req.file.filename;
    const mediaType = req.file.mimetype.startsWith('image') ? 'image' : 'video';
    const { to }    = req.body;
    const status    = isOnline(to) ? 'delivered' : 'sent';

    const doc = await PrivateMsg.create({
      from: req.user.name,
      to,
      message: '',
      mediaUrl,
      mediaType,
      status
    });

    res.json({ success: true, mediaUrl, mediaType, id: doc._id.toString(), status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Message History ──────────────────────────────────────────────────────────
app.get('/api/history/:otherUser', authMiddleware, async (req, res) => {
  const me    = req.user.name;
  const other = req.params.otherUser;
  try {
    const msgs = await PrivateMsg.find({
      $or: [{ from: me, to: other }, { from: other, to: me }]
    }).sort({ createdAt: 1 }).limit(200);
    res.json(msgs);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

app.get('/chat', authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.headers.cookie?.match(/token=([^;]+)/)?.[1];
  if (!token) return next(new Error('Authentication required'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { next(new Error('Invalid token')); }
});

function broadcastOnlineList() {
  io.emit('online-users', Object.keys(onlineUsers));
}

io.on('connection', async (socket) => {
  const userName   = socket.user.name;
  const wasOffline = !onlineUsers[userName];
  addOnlineUser(userName, socket.id);
  broadcastOnlineList();
  if (wasOffline) socket.broadcast.emit('system', `${userName} is online... 👋`);

  // ── User ka net wapas ON hua -> jitne bhi "sent" (single-tick) messages
  //    uske liye pending the, unko "delivered" (double grey tick) bana do
  //    aur original sender ko real-time update bhejo.
  if (wasOffline) {
    try {
      const pending = await PrivateMsg.find({ to: userName, status: 'sent' });
      if (pending.length) {
        await PrivateMsg.updateMany(
          { _id: { $in: pending.map(m => m._id) } },
          { $set: { status: 'delivered' } }
        );
        const bySender = {};
        pending.forEach(m => {
          (bySender[m.from] = bySender[m.from] || []).push(m._id.toString());
        });
        Object.entries(bySender).forEach(([sender, ids]) => {
          emitToUser(sender, 'messages-delivered', { ids });
        });
      }
    } catch {}
  }

  // Group message
  socket.on('user-message', (data) => {
    io.emit('message', { name: userName, message: data.message });
  });

  // Private text message
  socket.on('private-message', async ({ to, message }) => {
    if (!message || !to) return;
    const status = isOnline(to) ? 'delivered' : 'sent';
    let doc;
    try {
      doc = await PrivateMsg.create({ from: userName, to, message, status });
    } catch { return; }

    const payload = {
      id: doc._id.toString(),
      from: userName,
      to,
      message,
      status,
      createdAt: doc.createdAt
    };
    emitToUser(to, 'private-message', payload);
    socket.emit('private-message', payload); // echo to sender so their UI shows correct tick
  });

  // Private media message (notify receiver after upload)
  socket.on('private-media', ({ to, mediaUrl, mediaType, id, status }) => {
    const payload = {
      id,
      from: userName,
      to,
      message: '',
      mediaUrl,
      mediaType,
      status: status || (isOnline(to) ? 'delivered' : 'sent'),
      createdAt: new Date()
    };
    emitToUser(to, 'private-message', payload);
    socket.emit('private-message', payload);
  });

  // Receiver ne chat khol kar messages dekh liye -> mark as "read" (blue tick)
  socket.on('mark-seen', async ({ otherUser }) => {
    if (!otherUser) return;
    try {
      const unseen = await PrivateMsg.find({ from: otherUser, to: userName, status: { $ne: 'read' } });
      if (!unseen.length) return;
      const ids = unseen.map(m => m._id);
      await PrivateMsg.updateMany({ _id: { $in: ids } }, { $set: { status: 'read' } });
      emitToUser(otherUser, 'messages-seen', { by: userName, ids: ids.map(i => i.toString()) });
    } catch {}
  });

  // ── WebRTC Signaling ────────────────────────────────────────────────────────
  socket.on('call-user', ({ to, offer, callType }) => {
    const delivered = emitToUser(to, 'incoming-call', { from: userName, offer, callType });
    if (!delivered) socket.emit('call-failed', { reason: `${to} abhi online nahi hai` });
  });

  socket.on('call-answer', ({ to, answer }) => {
    emitToUser(to, 'call-answered', { from: userName, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    emitToUser(to, 'ice-candidate', { from: userName, candidate });
  });

  socket.on('call-reject', ({ to }) => {
    emitToUser(to, 'call-rejected', { from: userName });
  });

  socket.on('call-end', ({ to }) => {
    emitToUser(to, 'call-ended', { from: userName });
  });

  socket.on('disconnect', () => {
    removeOnlineUser(userName, socket.id);
    broadcastOnlineList();
    if (!onlineUsers[userName]) io.emit('system', `${userName} left chat.`);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});