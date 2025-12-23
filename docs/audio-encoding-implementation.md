# Audio Encoding Implementation

## Overview

The audio encoder supports three codecs for Sendspin streaming:
- **Opus**: High-quality, low-latency codec (preferred)
- **FLAC**: Lossless codec (higher bandwidth)
- **PCM**: Uncompressed pass-through (highest bandwidth)

## Encoding Methods

### Opus Encoding

**Priority Order:**
1. **Native Library (@discordjs/opus)** - Best performance, lowest latency
   - Requires: `@discordjs/opus` package (optional dependency, Node 18+)
   - Uses native libopus bindings
   - Real-time encoding with minimal overhead
   - **Recommended for production** (maintained, actively developed)
   - Falls back to `node-opus` on Node 16 (unmaintained but functional)

2. **Command-line (ffmpeg)** - Fallback option
   - Requires: `ffmpeg` installed on system
   - Higher latency due to process spawning
   - More reliable across different systems
   - **Use if node-opus unavailable**

**Configuration:**
- Sample rate: 48000 Hz (Opus requirement)
- Channels: 2 (stereo)
- Bitrate: 128 kbps (configurable)
- Compression level: 10 (maximum)

### FLAC Encoding

**Method:**
- **Command-line (flac)** - Primary method
  - Requires: `flac` command-line tool installed
  - Lossless compression
  - Higher bandwidth than Opus
  - Good for high-quality streaming

**Configuration:**
- Sample rate: 44100 or 48000 Hz
- Channels: 2 (stereo)
- Bit depth: 16-bit
- Compression level: 5 (good balance)

### PCM Pass-through

- No encoding required
- Direct pass-through of captured audio
- Highest bandwidth requirement
- Lowest latency (no encoding overhead)

## Usage

```javascript
const AudioEncoder = require('./audio-encoder');

// Initialize encoder
const encoder = new AudioEncoder({
  codec: 'opus',           // 'opus', 'flac', or 'pcm'
  sampleRate: 48000,
  channels: 2,
  bitDepth: 16,
  encodingMethod: 'auto',   // 'auto', 'native', or 'command-line'
  logger: logger
});

await encoder.initialize();

// Encode PCM data
const pcmData = Buffer.from(/* ... */);
const encodedData = await encoder.encode(pcmData);

// Cleanup
encoder.cleanup();
```

## Performance Considerations

### Latency

1. **Native (@discordjs/opus or node-opus)**: ~5-10ms encoding latency
2. **Command-line (ffmpeg/flac)**: ~20-50ms encoding latency
   - Process spawning overhead
   - IPC communication
   - Buffer management

### Recommendations

- **For real-time streaming**: Use native `@discordjs/opus` if available (Node 18+)
- **For Node 16**: Falls back to `node-opus` (unmaintained but functional)
- **For high-quality streaming**: Use FLAC if bandwidth allows
- **For lowest latency**: Use PCM (if network bandwidth sufficient)
- **Fallback**: Command-line tools work but add latency

## Dependencies

### Required
- None (PCM pass-through works without dependencies)

### Optional (for native Opus)
- `@discordjs/opus`: `npm install @discordjs/opus` (optional dependency, requires Node 18+)
- `node-opus`: Legacy fallback (unmaintained, works on Node 16+)

### System Requirements (for command-line fallbacks)
- **Opus**: `ffmpeg` installed (`apt-get install ffmpeg` on Debian/Ubuntu)
- **FLAC**: `flac` command installed (`apt-get install flac` on Debian/Ubuntu)

## Testing

The encoder is tested with:
- PCM pass-through (always works)
- Opus initialization (checks for available methods)
- FLAC initialization (checks for available methods)
- Error handling for missing dependencies

## Future Improvements

1. **Native FLAC encoder**: Add native FLAC encoding library
2. **Streaming encoding**: Encode in chunks rather than full buffers
3. **Adaptive bitrate**: Adjust encoding quality based on network conditions
4. **Multi-threaded encoding**: Use worker threads for command-line encoding
5. **Buffer pooling**: Reuse buffers to reduce allocations

## Troubleshooting

### Opus encoding fails
- Check if `@discordjs/opus` is installed: `npm list @discordjs/opus`
- On Node 16, it will try `node-opus` as fallback
- Check if `ffmpeg` is available: `which ffmpeg`
- Verify sample rate is 48000 Hz (Opus requirement)

### FLAC encoding fails
- Check if `flac` command is available: `which flac`
- Verify system has flac package installed

### High latency
- Use native `@discordjs/opus` (Node 18+) or `node-opus` (Node 16) instead of command-line tools
- Consider using PCM if network bandwidth allows
- Reduce buffer sizes if possible

