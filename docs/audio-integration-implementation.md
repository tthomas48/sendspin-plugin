# Audio Integration Implementation

## Overview

The audio integration consists of three main components:

1. **AudioCapture** - Captures audio from Volumio's playback system
2. **AudioEncoder** - Encodes PCM audio to Sendspin formats (Opus, FLAC, PCM)
3. **AudioStreamer** - Orchestrates capture, encoding, and streaming

## Architecture

```
Volumio Playback → AudioCapture → AudioEncoder → SendspinServer → Clients
```

## Components

### AudioCapture (`lib/audio-capture.js`)

Captures audio from Volumio using multiple methods:

1. **PulseAudio** (preferred)
   - Uses `parec` to capture from default sink monitor
   - Works if PulseAudio is available
   - Command: `parec --format=s16le --rate=48000 --channels=2 --device=@DEFAULT_SINK@.monitor`

2. **ALSA**
   - Uses `arecord` to capture from ALSA device
   - Requires ALSA loopback module: `modprobe snd-aloop`
   - Command: `arecord -D hw:Loopback,0,0 -f S16_LE -r 48000 -c 2`

3. **Auto-detect**
   - Tries PulseAudio first, then ALSA
   - Falls back gracefully if neither is available

### AudioEncoder (`lib/audio-encoder.js`)

Encodes PCM audio to Sendspin-supported formats:

1. **Opus** (preferred)
   - Uses `opus-encdec` library from sendspin-js
   - Low latency, good compression
   - **Status**: Placeholder - needs full implementation

2. **FLAC**
   - Lossless compression
   - **Status**: Placeholder - needs FLAC encoder library

3. **PCM**
   - No encoding, pass-through
   - **Status**: Working

### AudioStreamer (`lib/audio-streamer.js`)

Orchestrates the audio pipeline:
- Initializes encoder based on preferred codec
- Starts audio capture
- Processes audio data through encoder
- Sends encoded audio to Sendspin server for distribution

## Integration Flow

1. **Client Connects**
   - Sendspin server receives CLIENT_HELLO
   - Plugin starts audio streaming if not already active
   - Audio capture begins

2. **Audio Processing**
   - AudioCapture captures PCM audio from Volumio
   - AudioEncoder encodes to selected format
   - AudioStreamer sends encoded chunks to Sendspin server
   - Sendspin server broadcasts to all connected clients

3. **Client Disconnects**
   - If last client, stop audio streaming
   - Clean up capture and encoder

## Configuration

### Capture Method
- `auto` - Auto-detect best available method
- `pulse` - Force PulseAudio
- `alsa` - Force ALSA

### Preferred Codec
- `opus` - Opus (low latency, good compression)
- `flac` - FLAC (lossless)
- `pcm` - PCM (no compression, lowest latency)

## Current Status

✅ **Implemented:**
- AudioCapture with PulseAudio and ALSA support
- AudioEncoder framework
- AudioStreamer orchestration
- Integration with Sendspin server
- Configuration UI

⚠️ **Needs Implementation:**
- Full Opus encoding (currently placeholder)
- FLAC encoding (currently placeholder)
- Error handling and recovery
- Audio format negotiation with clients
- Buffer management for smooth streaming

## Testing

To test audio capture:

1. **Check available methods:**
   ```javascript
   const AudioCapture = require('./lib/audio-capture');
   const methods = await AudioCapture.getAvailableMethods();
   console.log('Available methods:', methods);
   ```

2. **Test capture:**
   ```javascript
   const capture = new AudioCapture({ captureMethod: 'pulse' });
   await capture.start((data, format) => {
     console.log('Audio data:', data.length, 'bytes');
   });
   ```

## Next Steps

1. **Implement Opus Encoding**
   - Integrate opus-encdec properly
   - Handle Opus packetization
   - Generate codec headers

2. **Implement FLAC Encoding**
   - Add FLAC encoder library
   - Handle FLAC encoding

3. **Error Handling**
   - Handle capture failures gracefully
   - Retry logic for capture restarts
   - Fallback between capture methods

4. **Performance Optimization**
   - Buffer management
   - Chunk sizing for optimal latency
   - Threading/async optimization

5. **Testing**
   - Test with actual Volumio installation
   - Verify audio quality
   - Test with multiple clients
   - Measure latency



