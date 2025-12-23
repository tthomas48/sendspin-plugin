# Audio Pipeline Integration Research

## Goal

Integrate Sendspin server with Volumio's audio pipeline to:
1. **Capture audio** from Volumio's current playback
2. **Encode audio** to Sendspin-supported formats (Opus, FLAC, PCM)
3. **Stream audio** to connected Sendspin clients

## Volumio Audio Architecture

### AAMPP (Advanced Audio Modular Processing Pipeline)
- Volumio's audio processing system
- Allows plugins to process audio from any source
- Used for DSP effects, resampling, etc.
- **Note**: AAMPP is for processing audio, not necessarily for capturing it

### Audio Interface Plugins
- Examples: Airplay, UPnP, Bluetooth
- Typically **receive** audio streams and feed them to Volumio
- Use MPD (Music Player Daemon) to play audio

### MPD (Music Player Daemon)
- Volumio's core audio playback engine
- Handles audio output
- Plugins can add streams to MPD queue

## Integration Approaches

### Approach 1: ALSA Loopback (Capture from Hardware)
- Use ALSA loopback device to capture audio output
- Pros: Captures actual audio being played
- Cons: Requires ALSA configuration, may add latency

### Approach 2: MPD Stream Capture
- Intercept audio at MPD level before output
- Pros: Direct access to audio data
- Cons: May require MPD modifications or special APIs

### Approach 3: Volumio Audio API
- Use Volumio's plugin APIs to access audio streams
- Pros: Official API, well-integrated
- Cons: Need to research available APIs

### Approach 4: PulseAudio/ALSA Monitor
- Monitor audio output using PulseAudio or ALSA
- Pros: Standard Linux audio approach
- Cons: May not be available on all Volumio installations

## Research Questions

1. How do other audio_interface plugins receive audio?
2. Does Volumio provide APIs to access current playback audio?
3. Can we tap into MPD's audio stream?
4. Is ALSA loopback available on Volumio?
5. What audio formats does Volumio use internally?

## Next Steps

1. Review Volumio plugin API documentation for audio access
2. Examine existing audio_interface plugin source code
3. Test ALSA loopback availability
4. Research MPD integration options
5. Design audio capture and encoding pipeline



