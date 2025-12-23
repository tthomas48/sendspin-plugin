# Sendspin Research Notes

## What is Sendspin?

Sendspin is an open standard by the [Open Home Foundation](https://www.openhomefoundation.org/) for a synchronized music experience across multiple devices and rooms.

## Key Features

1. **Synchronized Audio Playback**
   - Play audio in sync across multiple speakers
   - Multi-room audio support

2. **Music Control & Metadata**
   - Control playback from tablets or screens
   - Display album art and track information

3. **Visualization** (coming soon)
   - Visualize audio playback on connected lights

## Protocol Details

- **Status**: Public preview (specification subject to change)
- **License**: Available for commercial usage (contact for licensing info)
- **Open Standard**: Unlike AirPlay and Cast, Sendspin is open and interoperable

## Existing Implementations

### Reference Implementations
- **sendspin-cli**: Command-line client
- **sendspin-go**: Go-based server/client implementation
- **Music Assistant**: Integration available (experimental mode for Cast players)
- **Home Assistant Voice PE**: Beta firmware support
- **ESPHome**: Example configuration for album art and control

### Protocol Specification
- Available at: https://www.sendspin-audio.com/spec
- SDKs and code samples available

## Technical Considerations

### Integration Points
- Sendspin streams can be played in browsers
- Google Cast-enabled devices supported
- Works with Music Assistant
- Command-line tools available for testing

### Community Resources
- Discord: Music Assistant Discord - #sendspin-beta-testing channel
- GitHub: Open Home Foundation repositories

## Protocol Details (Research Findings)

### Communication Protocol
- **WebSocket-based**: Uses WebSocket for bidirectional communication
- **Message Types**: CLIENT_HELLO, SERVER_HELLO, CLIENT_TIME, SERVER_TIME, CLIENT_STATE, SERVER_STATE, SERVER_COMMAND, STREAM_START, STREAM_END, STREAM_CLEAR, STREAM_REQUEST_FORMAT, GROUP_UPDATE
- **Bidirectional**: Protocol supports both client and server roles

### Audio Format
- **Codec**: Opus codec support (via opus-encdec)
- **Streaming**: Audio streamed via WebSocket after format negotiation
- **Format Negotiation**: STREAM_REQUEST_FORMAT and STREAM_START messages handle format negotiation

### Synchronization
- **Time Synchronization**: Uses CLIENT_TIME and SERVER_TIME messages for clock synchronization
- **Time Filter**: SendspinTimeFilter handles time-based synchronization
- **Clock-Synchronized**: Protocol designed for clock-synchronized audio streaming

### Device Discovery
- **TBD**: Need to research mDNS/SSDP usage
- **Connection**: WebSocket connections established after discovery

## JavaScript/TypeScript Implementation

### @music-assistant/sendspin-js Library

**Status**: ✅ Available and actively maintained (v0.4.5)

**Key Findings**:
- TypeScript library implementing Sendspin Protocol
- Provides `SendspinPlayer` class
- Handles WebSocket connections, protocol messages, audio processing
- Used in production by Music Assistant web interface
- Used in Google Cast receiver for Sendspin streams
- Includes Opus codec support

**Components**:
- `SendspinPlayer` - Main player class
- `WebSocketManager` - WebSocket handling
- `ProtocolHandler` - Protocol message handling
- `AudioProcessor` - Audio processing and playback
- `StateManager` - Player state management
- `SendspinTimeFilter` - Time synchronization

**Critical Question**: Can it act as a SERVER/RECEIVER?
- Library name suggests CLIENT/PLAYER role
- Protocol supports bidirectional communication
- Need to verify if it can listen for connections vs. only connecting

See `library-evaluation.md` for detailed analysis.

## Questions to Research

1. ✅ Protocol uses WebSocket for communication
2. ✅ Opus codec supported
3. ✅ Time synchronization via CLIENT_TIME/SERVER_TIME messages
4. ❓ How does device discovery work? (mDNS/SSDP?)
5. ❓ Can sendspin-js act as a server/receiver?
6. ❓ What are the authentication/security requirements?

## Next Steps

- [x] Review Sendspin protocol specification (in progress)
- [x] Examine sendspin-js library
- [x] Understand audio streaming mechanism (WebSocket + Opus)
- [ ] **URGENT**: Determine if sendspin-js can act as server/receiver
- [ ] Research device discovery protocol
- [ ] Review Music Assistant integration for reference
- [ ] Test sendspin-js with receiver implementation

