# 🌌 VoidChat (GhostChat)

> **Zero-Knowledge, Ephemeral, True Peer-to-Peer Encrypted Communication Protocol**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Socket.io](https://img.shields.io/badge/Socket.io-4.8-010101?logo=socket.io&logoColor=white)](https://socket.io/)
[![WebRTC](https://img.shields.io/badge/WebRTC-P2P_DataChannel-333333?logo=webrtc&logoColor=white)](https://webrtc.org/)

---

## 📖 Executive Summary

**VoidChat** is a decentralized, privacy-first ephemeral communication platform. Unlike conventional chat applications that store messages in persistent databases, route encrypted payloads through corporate relay servers, or harvest telemetry, **VoidChat operates on a zero-knowledge, zero-storage paradigm**:

1. **Stateless Signaling**: The central server functions solely as an ephemeral matchmaker to exchange initial WebRTC Session Description Protocol (SDP) signals.
2. **True Peer-to-Peer DataChannels**: Once the initial handshake completes, all communications traverse directly between participants via end-to-end encrypted WebRTC `RTCDataChannel` connections.
3. **No Database & No Logs**: The server contains no database, stores no chat history, logs no IP mappings, and discards all room memberships upon socket disconnection.
4. **Disappearing State**: Refreshing or closing the tab permanently deletes all conversation keys and message histories from client memory.

---

## 🏛️ High-Level System Architecture

```mermaid
graph TD
    subgraph Signaling_Phase [1. Ephemeral Signaling Phase - Port 5000]
        ClientA["User A (Initiator)"] <-->|join-room / relay-signal| Server["Stateless Signaling Server (Node + Socket.io)"]
        ClientB["User B (Receiver)"] <-->|join-room / relay-signal| Server
    end

    subgraph NAT_Traversal [2. ICE Candidate Resolution]
        ClientA <-->|STUN Binding Requests| GoogleSTUN["Google STUN Servers (stun.l.google.com:19302)"]
        ClientB <-->|STUN Binding Requests| GoogleSTUN
    end

    subgraph Direct_P2P [3. Direct End-to-End Encrypted DataChannel]
        ClientA <===>|Direct DTLS / SCTP Encrypted Chat peer.send / peer.on data| ClientB
    end

    style Server fill:#1e1b4b,stroke:#818cf8,stroke-width:2px,color:#fff
    style GoogleSTUN fill:#064e3b,stroke:#34d399,stroke-width:2px,color:#fff
    style ClientA fill:#312e81,stroke:#a78bfa,stroke-width:2px,color:#fff
    style ClientB fill:#312e81,stroke:#a78bfa,stroke-width:2px,color:#fff
```

### Architectural Separation of Concerns

* **Signaling Plane (`ghost-chat-backend`)**:
  * Facilitates room coordination using lightweight Socket.io rooms.
  * Relays raw WebRTC SDP offers, answers, and ICE candidate packages blindly without inspecting or caching payloads.
  * Completely agnostic to message contents, user identities, or chat state.

* **Data Plane (`ghost-chat-frontend`)**:
  * Negotiates symmetric cryptographic keys via Datagram Transport Layer Security (DTLS).
  * Establishes a bidirectional Stream Control Transmission Protocol (SCTP) DataChannel directly over UDP.
  * Chat messages are piped directly through `peer.send(message)`, completely bypassing the backend server.

---

## 🤝 Signaling & WebRTC Handshake Sequence

The following sequence diagram details the exact protocol lifecycle when two peers join an ephemeral room:

```mermaid
sequenceDiagram
    autonumber
    actor PeerA as Peer A (First User)
    participant Server as Signaling Server (Port 5000)
    actor PeerB as Peer B (Stranger)
    participant STUN as Google STUN Servers

    Note over PeerA,Server: Room Creation & Entry
    PeerA->>Server: socket.emit('join-room', 'room-xyz')
    Server->>Server: socket.join('room-xyz')
    
    Note over PeerB,Server: Peer B Discovers & Enters Room
    PeerB->>Server: socket.emit('join-room', 'room-xyz')
    Server->>Server: socket.join('room-xyz')
    Server-->>PeerA: socket.to('room-xyz').emit('peer-joined', socketB.id)

    Note over PeerA,STUN: Initiator Handshake Generation
    PeerA->>STUN: Query Public IP & Port Reflexive Candidates
    STUN-->>PeerA: Return Server Reflexive Candidates
    PeerA->>PeerA: new SimplePeer({ initiator: true, trickle: false, config: STUN })
    PeerA->>PeerA: Generate SDP Offer + Gather ICE Candidates

    PeerA->>Server: socket.emit('relay-signal', { roomId: 'room-xyz', signal: offerSDP })
    Server-->>PeerB: socket.to('room-xyz').emit('relay-signal', { roomId: 'room-xyz', signal: offerSDP })

    Note over PeerB,STUN: Receiver Ingestion & Answer Generation
    PeerB->>PeerB: new SimplePeer({ initiator: false, trickle: false, config: STUN })
    PeerB->>STUN: Query Public Reflexive Candidates
    STUN-->>PeerB: Return Server Reflexive Candidates
    PeerB->>PeerB: peer.signal(offerSDP)
    PeerB->>PeerB: Generate SDP Answer

    PeerB->>Server: socket.emit('relay-signal', { roomId: 'room-xyz', signal: answerSDP })
    Server-->>PeerA: socket.to('room-xyz').emit('relay-signal', { roomId: 'room-xyz', signal: answerSDP })

    Note over PeerA,PeerB: Direct P2P DataChannel Established
    PeerA->>PeerA: peer.signal(answerSDP)
    PeerA->>PeerB: DTLS Cryptographic Handshake & Key Derivation
    Note over PeerA,PeerB: peer.on('connect') Fires on Both Clients!

    Note over PeerA,PeerB: Zero-Server P2P Chatting
    PeerA->>PeerB: peer.send('Hello Stranger') [Direct SCTP Packet]
    PeerB->>PeerB: peer.on('data') -> Decodes & Renders Message
    PeerB->>PeerA: peer.send('Hey there!') [Direct SCTP Packet]
    PeerA->>PeerA: peer.on('data') -> Decodes & Renders Message
```

---

## 🔒 Security & Privacy Architecture

### 1. End-to-End Cryptographic Security
* **DTLS (Datagram Transport Layer Security)**: All WebRTC DataChannel traffic is mandatorily encrypted with DTLS (RFC 8261 / RFC 7345). Eavesdropping, tampering, or message interception by third parties on intermediary networks is mathematically prohibited.
* **SCTP over DTLS**: Chat messages travel over an encapsulated SCTP channel authenticated and encrypted with AES-GCM cipher suites negotiated dynamically between peers.

### 2. Zero-Knowledge Stateless Server
* **Zero Database Dependability**: The backend uses no SQLite, PostgreSQL, MongoDB, or Redis instance.
* **No Message Forwarding**: The server codebase possesses zero endpoints or socket events for message transmission (`chat-message` or similar events do not exist).
* **Instant Disconnection Cleanup**: As soon as a client closes their connection, Socket.io garbage-collects the socket identifier from memory.

### 3. STUN Candidate Harvesting & NAT Traversal
* Configured with Google's public STUN servers:
  ```javascript
  const PEER_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };
  ```
* Resolves Session Traversal Utilities for NAT (STUN) candidates, permitting direct communication between peers across Symmetric, Restricted Cone, or Port-Restricted NAT environments without leaking internal enterprise LAN parameters.

### 4. Client-Side Volatility
* Message data resides strictly in volatile React component state (`useState([])`).
* No use of `localStorage`, `sessionStorage`, `IndexedDB`, or cookies.
* Refreshing the browser or clicking **Leave Room** triggers `peer.destroy()`, instantly severing the WebRTC channel and wiping all plaintext messages from RAM.

---

## 🛠️ Technology Stack Breakdown

| Component | Technology | Version | Purpose |
|---|---|---|---|
| **Backend Runtime** | Node.js | `>= 18.x` | High-performance asynchronous event loop |
| **Backend Framework** | Express | `5.3.0` | HTTP infrastructure & health probe endpoints |
| **Signaling Engine** | Socket.io | `4.8.4` | Real-time bidirectional room-based signaling |
| **CORS Middleware** | CORS | `2.8.6` | Cross-origin resource sharing policy enforcement |
| **Frontend Framework** | React | `19.2.8` | Declarative reactive UI components & state hooks |
| **Build Bundler** | Vite | `8.3.4` | Ultra-fast Hot Module Replacement (HMR) & ESBuild bundling |
| **WebRTC Client** | simple-peer | `9.12.0` | Concise WebRTC DataChannel abstraction |
| **Node.js Polyfills** | vite-plugin-node-polyfills | `0.23.0` | Browser shims for `Buffer`, `process`, and `global` |
| **Styling** | Vanilla CSS3 | Standard | Custom cyber-spectral design system with glassmorphism |
| **Typography** | Google Fonts | Web | 'Outfit', 'Inter', and 'JetBrains Mono' |

---

## 📂 Project Directory Structure

```text
VoidChat/
├── .gitignore                      # Root ignore rules for node_modules, dist, logs
├── LICENSE                         # MIT License
├── README.md                       # Comprehensive architectural documentation
├── ghost-chat-backend/             # Stateless WebRTC signaling server
│   ├── package.json                # Dependencies: express, socket.io, cors
│   ├── package-lock.json
│   └── server.js                   # Socket server listening on port 5000
└── ghost-chat-frontend/            # Vite + React 19 WebRTC client application
    ├── index.html                  # HTML5 entry with Google Fonts & SEO metadata
    ├── package.json                # Dependencies: react, simple-peer, socket.io-client
    ├── package-lock.json
    ├── vite.config.js              # Vite configuration with node polyfills
    ├── public/
    │   ├── favicon.svg             # Custom spectral ghost favicon
    │   └── icons.svg
    └── src/
        ├── main.jsx                # React root mount with window.global polyfill
        ├── index.css               # Design tokens, color system, CSS variables
        ├── App.jsx                 # Stateful room join, WebRTC lifecycle, P2P chat
        └── App.css                 # Glassmorphic card styling, message bubbles
```

---

## 🚀 Getting Started & Installation

### Prerequisites
* **Node.js**: `v18.0.0` or higher
* **npm**: `v9.0.0` or higher

---

### Step 1: Clone the Repository
```bash
git clone https://github.com/Souvik-Das-23/VoidChat.git
cd VoidChat
```

---

### Step 2: Start the Signaling Backend

```bash
cd ghost-chat-backend
npm install
npm start
```

*The signaling server will start listening at `http://localhost:5000`.*

---

### Step 3: Start the Frontend Application

In a separate terminal:

```bash
cd ghost-chat-frontend
npm install
npm run dev
```

*The Vite development server will start at `http://localhost:5173`.*

---

## 🧪 Testing Peer-to-Peer Communication

To test end-to-end P2P chat locally:

1. Open your browser to **`http://localhost:5173`** (**Tab 1**).
2. Open a separate browser window or incognito session to **`http://localhost:5173`** (**Tab 2**).
3. In **Tab 1**:
   * Click **✦ Auto-generate** (or input code `aaa111`).
   * Click **Join Room**.
4. In **Tab 2**:
   * Input the exact room code (e.g. `aaa111`).
   * Click **Join Room**.
5. Observe the status badge switch to **`🔒 P2P Encrypted Active`**.
6. Type a message in Tab 1 and hit **Send**:
   * The message is delivered directly via WebRTC DataChannel.
   * Rendered labeled as **"Me"** on Tab 1, and **"Stranger"** on Tab 2.
   * Verify the terminal running `ghost-chat-backend`: **zero chat messages pass through the server**.

---

## 📡 Socket.io Event API Reference

| Event Name | Direction | Payload Schema | Description |
|---|---|---|---|
| `join-room` | Client ➔ Server | `roomId: string` | Registers the socket into the specified room. |
| `peer-joined` | Server ➔ Client | `peerId: string` | Notifies existing room participants that a new peer arrived. |
| `relay-signal` | Client ➔ Server | `{ roomId: string, signal: object }` | Submits SDP offer/answer or ICE candidate for relay. |
| `relay-signal` | Server ➔ Client | `{ roomId: string, signal: object }` | Delivers the relayed WebRTC signal to the target peer. |

---

## 📜 WebRTC SimplePeer Lifecycle API

| Event | Direction | Trigger | Handler Action |
|---|---|---|---|
| `peer.on('signal')` | Internal ➔ Outgoing | Generated SDP Offer/Answer | Dispatches signal to room via `socket.emit('relay-signal')`. |
| `peer.on('connect')` | Incoming | DataChannel successfully opened | Marks `isP2PConnected = true`; enables message input UI. |
| `peer.on('data')` | Incoming | Peer transmitted raw byte payload | Decodes `Uint8Array` to text; updates chat log with `"Stranger"`. |
| `peer.on('close')` | Disconnect | Peer severed connection | Resets peer ref; displays system notice; returns to standby. |
| `peer.on('error')` | Internal | Cryptographic or ICE failure | Logs error diagnostics without leaking sensitive data. |

---

## 📄 License

This project is open-sourced under the terms of the **[MIT License](file:///f:/PROJECT/VoidChat/LICENSE)**.

---

<p align="center">
  Built with 💜 for zero-knowledge, decentralized peer-to-peer privacy.
</p>