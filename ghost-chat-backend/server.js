const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// Enable CORS for Express HTTP routes
app.use(cors());

// Basic health-check route
app.get('/', (req, res) => {
  res.send('Ghost Chat Backend is running.');
});

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io with CORS enabled
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Socket.io connection handling (stateless, no database)
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Handle 'join-room':
  // Joins the socket to a room based on the provided ID and emits a 'peer-joined' event to others in that room
  socket.on('join-room', (roomId, peerId) => {
    const targetRoom = typeof roomId === 'object' && roomId !== null
      ? (roomId.roomId || roomId.room || roomId.id)
      : roomId;

    const peer = peerId || (typeof roomId === 'object' && roomId !== null ? (roomId.peerId || roomId.userId) : null) || socket.id;

    if (!targetRoom) {
      console.warn(`[join-room] Missing room ID from socket ${socket.id}`);
      return;
    }

    socket.join(targetRoom);
    console.log(`Socket ${socket.id} joined room: ${targetRoom}`);

    // Notify other peers in the room
    socket.to(targetRoom).emit('peer-joined', peer);
  });

  // Handle 'relay-signal':
  // Takes signal data and emits it to a specific room
  socket.on('relay-signal', (data, maybeSignal) => {
    let targetRoom;
    let signalData = data;

    if (typeof data === 'object' && data !== null) {
      targetRoom = data.roomId || data.room || data.to;
      signalData = maybeSignal !== undefined ? maybeSignal : data;
    } else if (typeof data === 'string') {
      targetRoom = data;
      signalData = maybeSignal !== undefined ? maybeSignal : data;
    }

    if (!targetRoom) {
      console.warn(`[relay-signal] Missing target room from socket ${socket.id}`);
      return;
    }

    // Relay the signal to others in the specified room
    socket.to(targetRoom).emit('relay-signal', signalData);
    console.log(`Relayed signal from socket ${socket.id} to room: ${targetRoom}`);
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
