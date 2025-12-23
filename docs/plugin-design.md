# Sendspin Volumio Plugin Design

## Architecture Overview

This document outlines the design decisions for the Sendspin Volumio plugin.

## Plugin Category

**Category**: `audio_interface`

**Rationale**: Sendspin provides external audio streaming similar to Airplay, UPnP, and Bluetooth. It's not a browsable music service but rather an interface for receiving and playing audio streams.

## Core Functionality

### 1. Sendspin Server/Receiver
- Listen for incoming Sendspin audio streams
- Handle device discovery and connection
- Manage multiple concurrent streams (if supported)

### 2. Audio Pipeline Integration
- Receive Sendspin audio stream
- Convert/transcode to format compatible with Volumio's audio system
- Route audio to Volumio's playback engine

### 3. Control & Metadata
- Expose playback controls (play, pause, stop, volume)
- Display track metadata (title, artist, album, artwork)
- Sync state with Volumio's UI

### 4. Device Management
- Discover Sendspin-compatible devices
- Handle device pairing/authentication
- Manage device connections

## Plugin Structure

```
sendspin-plugin/
├── index.js              # Main plugin entry point
├── package.json          # Plugin metadata
├── UIConfig.json        # Configuration UI
├── install.sh           # Installation script
├── lib/
│   ├── sendspin-server.js    # Sendspin protocol implementation
│   ├── audio-handler.js      # Audio pipeline integration
│   ├── device-manager.js     # Device discovery & management
│   └── metadata-handler.js   # Metadata processing
└── README.md
```

## Key Design Decisions

### TBD - To Be Discussed

1. **Sendspin Implementation** ✅ DECISION: **Fork sendspin-js and Add Server Support**
   - **Chosen Approach**: **Fork + Copy Strategy**
     - ✅ Fork `sendspin-js` repository
     - ✅ Add server components (WebSocketServer, ServerProtocolHandler, SendspinServer)
     - ✅ Copy modified code into Volumio plugin's `lib/` directory
     - ✅ Adapt for Volumio (remove browser code, add Volumio audio integration)
     - ✅ Reuse existing types, protocol structures, and patterns
   - **Rationale**: 
     - Small codebase (8 files) - manageable to extend
     - Reuse existing protocol implementation (tested, production-ready)
     - Maintain protocol compatibility
     - Can contribute back to upstream
     - Self-contained plugin (no external npm dependencies needed)
   - **Alternative Considered**: Custom implementation from scratch
     - More code to write (~40-50 hours vs ~35-45 hours)
     - Less reuse of existing tested code
   - See `fork-analysis.md` for detailed feasibility analysis
   - See `library-evaluation.md` for comparison of options

2. **Audio Format Handling**
   - What formats does Sendspin use?
   - What transcoding is needed?
   - How to integrate with Volumio's audio pipeline?

3. **Multi-Device Support**
   - Support multiple Sendspin devices simultaneously?
   - Single device at a time?
   - Device selection UI?

4. **State Management**
   - How to sync Sendspin state with Volumio state?
   - Handle conflicts (user controls from multiple sources)?
   - Queue management?

5. **Configuration**
   - Port settings
   - Discovery settings
   - Audio quality/format preferences
   - Device whitelist/blacklist

6. **Error Handling**
   - Network errors
   - Device disconnection
   - Audio pipeline errors
   - Protocol errors

## Integration Points

### Volumio APIs to Use
- [ ] Plugin system APIs (enable/disable/start/stop)
- [ ] Audio pipeline APIs
- [ ] Playback control APIs
- [ ] Metadata APIs
- [ ] Configuration APIs
- [ ] Logging APIs

### External Dependencies
- [ ] Sendspin protocol library/implementation
- [ ] Audio processing libraries (if transcoding needed)
- [ ] Network libraries for discovery/streaming

## User Experience

### Installation
- Install from Volumio plugin store
- Automatic dependency installation via install.sh

### Configuration
- Simple UI for basic settings
- Device discovery and selection
- Audio quality preferences

### Usage
- Appears as audio input source in Volumio
- Can be selected like other audio interfaces
- Shows metadata and controls in Volumio UI

## Open Questions

1. Does Sendspin support being a receiver, or only a sender?
2. What's the relationship between Sendspin and Volumio's existing audio sources?
3. Can Sendspin streams coexist with other audio sources?
4. How does Volumio handle multiple audio interfaces?
5. What's the expected latency for synchronized playback?

## Next Steps

- [ ] Review Sendspin protocol specification in detail
- [ ] Examine existing Volumio audio_interface plugins
- [ ] Research Volumio plugin APIs
- [ ] Prototype basic Sendspin server integration
- [ ] Test audio pipeline integration

