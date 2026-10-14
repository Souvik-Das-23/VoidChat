import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import Peer from 'simple-peer';
import './App.css';

const SOCKET_SERVER_URL = 'http://localhost:5000';

// WebRTC configuration with Google's free STUN servers
const PEER_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function App() {
  // Socket & Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [socketId, setSocketId] = useState('');
  const [isP2PConnected, setIsP2PConnected] = useState(false);

  // Screen State: 'login' | 'chat'
  const [currentScreen, setCurrentScreen] = useState('login');
  const [roomCode, setRoomCode] = useState('');
  const [joinedRoom, setJoinedRoom] = useState('');

  // Chat messages: [{ id, text, sender: 'me' | 'stranger' | 'system', timestamp }]
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');

  // Refs for stable access in socket and peer callbacks
  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const joinedRoomRef = useRef('');
  const messagesEndRef = useRef(null);

  // Auto-scroll on new message
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Clean up peer instance
  const destroyPeer = useCallback(() => {
    if (peerRef.current) {
      try {
        peerRef.current.destroy();
      } catch (err) {
        console.warn('Error destroying peer:', err);
      }
      peerRef.current = null;
    }
    setIsP2PConnected(false);
  }, []);

  // Helper to attach event listeners to a SimplePeer instance
  const attachPeerListeners = useCallback((peer) => {
    // 1. Peer sends signal data via socket.emit('relay-signal')
    peer.on('signal', (signal) => {
      console.log('Peer generated signal:', signal.type || 'candidate');
      if (socketRef.current && joinedRoomRef.current) {
        socketRef.current.emit('relay-signal', {
          roomId: joinedRoomRef.current,
          signal,
        });
      }
    });

    // 2. SimplePeer connection established (Chat is now P2P)
    peer.on('connect', () => {
      console.log('WebRTC P2P DataChannel connected!');
      setIsP2PConnected(true);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + Math.random(),
          text: '🔒 Direct P2P encrypted connection established with Stranger! Chatting directly via WebRTC DataChannel (Socket server is bypassed).',
          sender: 'system',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    });

    // 3. Receive message directly from peer via WebRTC DataChannel
    peer.on('data', (raw) => {
      console.log('Received raw P2P data payload');
      const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + Math.random(),
          text,
          sender: 'stranger',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    });

    peer.on('close', () => {
      console.log('P2P connection closed');
      setIsP2PConnected(false);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + Math.random(),
          text: 'Stranger disconnected. P2P session ended.',
          sender: 'system',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
      destroyPeer();
    });

    peer.on('error', (err) => {
      console.error('SimplePeer error:', err);
    });
  }, [destroyPeer]);

  // Initialize socket connection on component mount
  useEffect(() => {
    const socket = io(SOCKET_SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to signaling server with ID:', socket.id);
      setIsConnected(true);
      setSocketId(socket.id || '');
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from signaling server');
      setIsConnected(false);
      setSocketId('');
    });

    // Requirement 1:
    // When a second user joins the room, the first user creates an initiator SimplePeer instance
    // and sends a signal via socket.emit('relay-signal')
    socket.on('peer-joined', (peerId) => {
      console.log('Second user joined the room (peer-joined):', peerId);

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + Math.random(),
          text: 'Stranger joined the room. Initiating WebRTC P2P handshake...',
          sender: 'system',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);

      // Destroy any stale peer before creating the new initiator
      if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
      }

      const initiatorPeer = new Peer({
        initiator: true,
        trickle: false,
        config: PEER_CONFIG,
      });

      attachPeerListeners(initiatorPeer);
      peerRef.current = initiatorPeer;
    });

    // Requirement 2:
    // When a user receives a 'relay-signal' from the socket, they create a non-initiator SimplePeer
    // (if not already created) and pass the signal to it, then signal back.
    socket.on('relay-signal', (data) => {
      console.log('Received relay-signal from socket');
      const incomingSignal = data && data.signal ? data.signal : data;

      if (!incomingSignal) {
        console.warn('relay-signal received without signal data');
        return;
      }

      if (!peerRef.current) {
        console.log('Creating non-initiator SimplePeer instance');
        const receiverPeer = new Peer({
          initiator: false,
          trickle: false,
          config: PEER_CONFIG,
        });

        attachPeerListeners(receiverPeer);
        peerRef.current = receiverPeer;
        receiverPeer.signal(incomingSignal);
      } else {
        console.log('Passing incoming signal to existing SimplePeer');
        peerRef.current.signal(incomingSignal);
      }
    });

    return () => {
      destroyPeer();
      socket.disconnect();
    };
  }, [attachPeerListeners, destroyPeer]);

  // Handle joining a room
  const handleJoinRoom = (e) => {
    if (e) e.preventDefault();
    const cleanRoomCode = roomCode.trim();
    if (!cleanRoomCode) return;

    if (socketRef.current && socketRef.current.connected) {
      // Emit 'join-room' event to signaling server
      socketRef.current.emit('join-room', cleanRoomCode);
    }

    setJoinedRoom(cleanRoomCode);
    joinedRoomRef.current = cleanRoomCode;
    setCurrentScreen('chat');

    // Add initial system message
    setMessages([
      {
        id: Date.now(),
        text: `Entered room: #${cleanRoomCode}. Waiting for Stranger to join...`,
        sender: 'system',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  // Generate a random room code (e.g. aaa111)
  const handleGenerateRandomCode = () => {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const randLetters = Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
    const randDigits = Math.floor(100 + Math.random() * 900);
    setRoomCode(`${randLetters}${randDigits}`);
  };

  // Requirement 4:
  // When the user types a message and clicks Send, the message MUST be sent directly using peer.send(message)
  // — do NOT send chat messages through the socket.io server.
  const handleSendMessage = (e) => {
    if (e) e.preventDefault();
    const cleanMessage = messageInput.trim();
    if (!cleanMessage) return;

    if (!peerRef.current || !isP2PConnected) {
      alert('P2P encrypted channel is not active yet. Please wait for Stranger to connect.');
      return;
    }

    // DIRECT WebRTC P2P transmission (Bypasses socket server completely)
    peerRef.current.send(cleanMessage);

    // Display message from "Me"
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        text: cleanMessage,
        sender: 'me',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);

    setMessageInput('');
  };

  // Handle leaving the room back to login screen
  const handleLeaveRoom = () => {
    destroyPeer();
    setCurrentScreen('login');
    setJoinedRoom('');
    joinedRoomRef.current = '';
    setMessages([]);
  };

  // Copy room code to clipboard
  const handleCopyCode = () => {
    if (joinedRoom) {
      navigator.clipboard.writeText(joinedRoom);
    }
  };

  return (
    <div className="app-container">
      {/* Top Navbar */}
      <header className="top-navbar">
        <div className="brand-badge">
          <svg className="brand-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2a9 9 0 0 0-9 9c0 3.37 1.95 6.27 4.78 7.78V21a1 1 0 0 0 1.54.84L12 20.25l2.68 1.59A1 1 0 0 0 16.22 21v-2.22C19.05 17.27 21 14.37 21 11a9 9 0 0 0-9-9zm-2.5 10a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
          </svg>
          <span className="brand-font">GhostChat</span>
        </div>

        <div className="status-badge" id="socket-status-badge">
          <span className={`status-dot ${isConnected ? 'connected' : 'connecting'}`}></span>
          <span>{isConnected ? `Signaling Server Ready (${socketId ? socketId.slice(0, 5) : ''})` : 'Connecting to Server...'}</span>
        </div>
      </header>

      {/* State 1: Login / Join Room Screen */}
      {currentScreen === 'login' && (
        <main className="join-card-wrapper fade-in">
          <div className="glass-card">
            <div className="card-header">
              <div className="logo-glow-wrapper">
                <svg className="logo-large-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2a9 9 0 0 0-9 9c0 3.37 1.95 6.27 4.78 7.78V21a1 1 0 0 0 1.54.84L12 20.25l2.68 1.59A1 1 0 0 0 16.22 21v-2.22C19.05 17.27 21 14.37 21 11a9 9 0 0 0-9-9zm-2.5 10a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
                </svg>
              </div>
              <h1 className="card-title">GhostChat P2P</h1>
              <p className="card-subtitle">
                Enter an ephemeral room code to establish an encrypted WebRTC peer-to-peer connection with a stranger.
              </p>
            </div>

            <form onSubmit={handleJoinRoom}>
              <div className="form-group">
                <div className="input-label-row">
                  <label htmlFor="room-code-input" className="input-label">
                    Room Code
                  </label>
                  <button
                    type="button"
                    className="btn-quick-generate"
                    onClick={handleGenerateRandomCode}
                  >
                    ✦ Auto-generate
                  </button>
                </div>

                <div className="input-wrapper">
                  <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <input
                    id="room-code-input"
                    type="text"
                    className="custom-input"
                    placeholder="e.g. aaa111"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value)}
                    autoComplete="off"
                    autoFocus
                  />
                </div>
              </div>

              <button
                id="join-room-btn"
                type="submit"
                className="btn-primary"
                disabled={!roomCode.trim()}
              >
                <span>Join Room</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </form>

            <div className="card-footer-info">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              <span>True WebRTC P2P DataChannel • Zero chat data stored on servers</span>
            </div>
          </div>
        </main>
      )}

      {/* State 2: Chat Screen */}
      {currentScreen === 'chat' && (
        <main className="chat-window fade-in">
          {/* Chat Header */}
          <header className="chat-header">
            <div className="chat-room-meta">
              <button
                className="room-tag"
                id="copy-room-tag"
                title="Click to copy room code"
                onClick={handleCopyCode}
              >
                <span>#{joinedRoom}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>

              <span className={`p2p-badge ${isP2PConnected ? 'active' : 'waiting'}`} id="p2p-status-badge">
                {isP2PConnected ? '🔒 P2P Encrypted Active' : '⏳ Waiting for Stranger...'}
              </span>
            </div>

            <button
              id="leave-room-btn"
              type="button"
              className="btn-secondary"
              onClick={handleLeaveRoom}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              <span>Leave Room</span>
            </button>
          </header>

          {/* Chat Messages Display Area */}
          <section className="chat-messages-area" id="chat-messages-area">
            {messages.length === 0 ? (
              <div className="empty-chat-state">
                <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <h3 className="empty-state-title">No messages yet</h3>
                <p className="empty-state-desc">
                  Share code <strong>#{joinedRoom}</strong> with a friend to establish an encrypted P2P data connection.
                </p>
              </div>
            ) : (
              messages.map((msg) => {
                if (msg.sender === 'system') {
                  return (
                    <div key={msg.id} className="system-message-row">
                      <div className="system-message-pill">
                        <span className="system-dot"></span>
                        <span>{msg.text}</span>
                      </div>
                    </div>
                  );
                }

                // Requirement 6:
                // Make sure the chat UI handles displaying messages from both "Me" and "Stranger"
                const isMe = msg.sender === 'me';
                return (
                  <div
                    key={msg.id}
                    className={`message-row ${isMe ? 'me' : 'stranger'}`}
                  >
                    <span className="message-sender">
                      {isMe ? 'Me' : 'Stranger'}
                    </span>
                    <div className="message-bubble">{msg.text}</div>
                    <span className="message-time">{msg.timestamp}</span>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </section>

          {/* Chat Input Bar */}
          <footer className="chat-input-container">
            <form onSubmit={handleSendMessage} className="chat-input-form">
              <input
                id="message-input"
                type="text"
                className="message-input"
                placeholder={isP2PConnected ? "Type a direct P2P message..." : "Waiting for P2P connection with Stranger..."}
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                autoComplete="off"
                disabled={!isP2PConnected}
              />
              <button
                id="send-message-btn"
                type="submit"
                className="btn-send"
                disabled={!isP2PConnected || !messageInput.trim()}
              >
                <span>Send</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </form>
          </footer>
        </main>
      )}
    </div>
  );
}

export default App;
