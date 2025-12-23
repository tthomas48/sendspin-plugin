# Sendspin Library Evaluation

## Overview

This document evaluates available Sendspin implementations for use in the Volumio plugin.

## Available Options

### 1. @music-assistant/sendspin-js (TypeScript/JavaScript)

**Repository**: https://github.com/Sendspin/sendspin-js  
**NPM Package**: `@music-assistant/sendspin-js`  
**Latest Version**: 0.4.5 (Dec 18, 2024)  
**License**: Apache-2.0  
**Language**: TypeScript (compiles to JavaScript)

#### Capabilities

**What it IS:**
- TypeScript client library implementing the Sendspin Protocol
- Provides `SendspinPlayer` class for receiving and playing Sendspin streams
- Handles WebSocket connections, protocol messages, audio processing
- Includes time synchronization (SendspinTimeFilter)
- Supports audio output via HTML5 audio element or direct audio processing
- Used in production by Music Assistant's web interface
- Used in Google Cast receiver for Sendspin streams
- Includes Opus codec support (via opus-encdec dependency)

**What it DOES:**
- Connects to Sendspin servers as a client/player
- Receives audio streams via WebSocket
- Processes and plays synchronized audio
- Handles protocol messages (CLIENT_HELLO, SERVER_HELLO, CLIENT_TIME, SERVER_TIME, etc.)
- Manages player state (play, pause, volume, mute)
- Handles stream format negotiation

**What it DOES NOT DO (verified):**
- ❌ Act as a Sendspin SERVER (Volumio needs to receive streams) - **CONFIRMED CLIENT-ONLY**
- ❌ Device discovery/advertising (mDNS/SSDP)
- ❌ Listen for incoming WebSocket connections
- ❌ Send SERVER messages (only receives them)
- ❌ Full server-side protocol implementation

#### Key Components

From source code analysis:
- `SendspinPlayer` - Main player class
- `WebSocketManager` - WebSocket connection handling
- `ProtocolHandler` - Protocol message handling
- `AudioProcessor` - Audio processing and playback
- `StateManager` - Player state management
- `SendspinTimeFilter` - Time synchronization

#### Protocol Support

The library handles these message types:
- CLIENT_HELLO / SERVER_HELLO
- CLIENT_TIME / SERVER_TIME
- CLIENT_STATE / SERVER_STATE
- SERVER_COMMAND
- STREAM_START / STREAM_END / STREAM_CLEAR
- STREAM_REQUEST_FORMAT
- GROUP_UPDATE

#### Dependencies

- `opus-encdec` (^0.1.1) - Opus audio codec support
- Node.js >= 16.0.0

#### Pros

✅ TypeScript/JavaScript - Perfect for Volumio plugins  
✅ Actively maintained (recent updates)  
✅ Production-tested (used in Music Assistant)  
✅ Well-structured codebase  
✅ Handles complex protocol details (time sync, audio processing)  
✅ Includes Opus codec support  
✅ Can output to HTML5 audio or direct audio processing  

#### Cons

❌ **CLIENT-ONLY** - Cannot act as a server/receiver  
❌ Does not listen for incoming connections  
❌ Does not send SERVER messages (only receives them)  
❌ Device discovery not included  
❌ Must implement server functionality ourselves  

### 2. sendspin-cli (Python)

**Repository**: https://github.com/Sendspin/sendspin-cli  
**Language**: Python

#### Capabilities

- Command-line client for Sendspin
- Useful for testing and debugging
- Reference implementation

#### Pros

✅ Good for testing  
✅ Reference implementation  

#### Cons

❌ Command-line tool, not a library  
❌ Python (Volumio plugins are JavaScript)  
❌ Would require subprocess execution  
❌ Not suitable for integration  

### 3. sendspin-go (Go)

**Repository**: https://github.com/Sendspin/sendspin-go  
**Language**: Go

#### Capabilities

- Go implementation of Sendspin
- Includes both SERVER and PLAYER implementations
- More complete implementation

#### Pros

✅ Has both server and player implementations  
✅ More complete protocol support  

#### Cons

❌ Go language (not JavaScript)  
❌ Would require Node.js bindings or subprocess execution  
❌ More complex integration  

## Recommendation

### Primary Approach Options

#### Option A: Fork sendspin-js and Add Server Support ⭐ RECOMMENDED

**Rationale:**
1. **Reuse existing code** - Types, structures, protocol patterns
2. **Small codebase** - Only 8 source files, manageable to extend
3. **Protocol compatibility** - Same message formats, tested implementation
4. **Potential contribution** - Could contribute back to upstream
5. **TypeScript types** - Already defined and tested

**Implementation Strategy:**
1. **Fork sendspin-js** on GitHub
2. **Add server components**:
   - `WebSocketServerManager` - Server that listens for connections
   - `ServerProtocolHandler` - Send SERVER messages, receive CLIENT messages
   - `SendspinServer` - Main server class
   - `DeviceDiscovery` - mDNS advertising
3. **Copy to plugin** - Copy modified code into Volumio plugin's `lib/` directory
4. **Adapt for Volumio** - Remove browser code, add Volumio audio integration

**Estimated Effort**: ~35-45 hours
**Complexity**: Medium-High (but manageable)

See `fork-analysis.md` for detailed analysis.

#### Option B: Hybrid - Use sendspin-js as Reference + Custom Server

**Rationale:**
1. **Language Match**: TypeScript/JavaScript is perfect for Volumio plugins
2. **Protocol Reference**: Can reuse protocol message types and structures
3. **Audio Processing Patterns**: Can reference audio processing logic
4. **Production Tested**: Protocol implementation is proven in Music Assistant
5. **Custom Server**: Must implement server ourselves since library is client-only

**Implementation Strategy:**
1. **Use sendspin-js as reference** for:
   - Protocol message types (`types.ts`)
   - Message structure and format
   - Audio processing patterns (if applicable)
   - Time synchronization concepts

2. **Implement custom server** using:
   - Node.js `ws` library for WebSocket server
   - Custom protocol handler for SERVER messages
   - Device discovery (mDNS/SSDP library)
   - Audio stream transmission to clients

**Estimated Effort**: ~40-50 hours
**Complexity**: High (more code to write from scratch)

### Key Question: Can it act as a SERVER/RECEIVER? ✅ ANSWERED

**Investigation Results:**

After reviewing the source code ([protocol-handler.ts](https://github.com/Sendspin/sendspin-js/blob/a9e36bc989c3e8779f54b9f0002c0d79eac71dd9/src/protocol-handler.ts), [websocket-manager.ts](https://github.com/Sendspin/sendspin-js/blob/main/src/websocket-manager.ts), [index.ts](https://github.com/Sendspin/sendspin-js/blob/main/src/index.ts)):

**❌ NO - sendspin-js is CLIENT-ONLY**

**Evidence:**
1. **WebSocketManager.connect()** uses `new WebSocket(url)` - this is the **client** WebSocket API that **connects TO** a server
2. **SendspinPlayer.connect()** calls `wsManager.connect(url)` - it connects **TO** a Sendspin server
3. **ProtocolHandler.handleServerHello()** - This **receives** SERVER_HELLO messages from a server, it doesn't **send** them
4. The library **sends** CLIENT messages (client/hello, client/time, client/state) and **receives** SERVER messages (server/hello, server/time, server/command)

**Conclusion:**
- `sendspin-js` is a **CLIENT/PLAYER** library
- It connects **TO** Sendspin servers
- It receives audio streams **FROM** servers
- It **cannot** act as a server that accepts incoming connections
- For Volumio, we need a **SERVER** that accepts connections and sends streams

**What we CAN reuse:**
- Protocol message types and structures
- Audio processing logic (AudioProcessor)
- Time synchronization logic (SendspinTimeFilter)
- State management patterns

**What we MUST implement:**
- WebSocket **server** (using Node.js `ws` library)
- Server-side protocol handling (send SERVER_HELLO, SERVER_TIME, SERVER_STATE)
- Receive CLIENT messages (client/hello, client/time, client/state)
- Device discovery (mDNS/SSDP)
- Audio stream transmission to connected clients

### Alternative Approach: Hybrid

If `sendspin-js` is only a client:
1. Use `sendspin-js` for protocol message handling and audio processing
2. Implement server/receiver functionality ourselves:
   - WebSocket server (using Node.js `ws` library)
   - Device discovery (mDNS/SSDP)
   - Protocol message handling (can reuse parts of sendspin-js)
3. Bridge between our server and sendspin-js player

### Fallback: sendspin-go Integration

If JavaScript implementation is insufficient:
1. Use `sendspin-go` as a subprocess
2. Communicate via IPC or HTTP
3. More complex but provides full server functionality

## Decision Matrix

| Criteria | sendspin-js | sendspin-cli | sendspin-go | Custom |
|----------|-------------|--------------|-------------|--------|
| Language Match | ✅✅✅ | ❌ | ❌ | ✅✅✅ |
| Server Support | ❌ | ❌ | ✅✅✅ | ✅✅✅ |
| Client Support | ✅✅✅ | ✅✅ | ✅✅✅ | ✅✅✅ |
| Maintenance | ✅✅✅ | ✅✅ | ✅✅✅ | N/A |
| Integration Ease | ✅✅✅ | ❌ | ❌ | ⚠️ |
| Production Ready | ✅✅✅ | ✅ | ✅✅✅ | ❌ |

## Action Items

- [x] **COMPLETED**: Determine if `sendspin-js` can act as a server/receiver
  - ✅ Reviewed library source code - **CONFIRMED: CLIENT-ONLY**
  - ✅ WebSocketManager only connects TO servers, doesn't listen
  - ✅ ProtocolHandler receives SERVER messages, sends CLIENT messages
- [x] Decision: Use **Hybrid Approach**
  - Implement WebSocket server ourselves (Node.js `ws` library)
  - Reuse protocol message types from sendspin-js
  - Implement server-side protocol handling
  - Potentially reuse audio processing patterns
- [ ] Review Sendspin protocol spec for server implementation details
- [ ] Design server architecture (WebSocket server + protocol handler)
- [ ] Implement device discovery (mDNS/SSDP)
- [ ] Test server implementation with sendspin-js client

## References

- [sendspin-js GitHub](https://github.com/Sendspin/sendspin-js)
- [sendspin-js NPM](https://www.npmjs.com/package/@music-assistant/sendspin-js)
- [Sendspin Protocol Spec](https://www.sendspin-audio.com/spec)
- [Sendspin Code Page](https://www.sendspin-audio.com/code)

