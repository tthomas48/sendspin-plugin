# Volumio Plugin Development Research

## Plugin System Overview

Volumio plugins extend functionality and are installed from the Volumio Plugins store. They're organized by categories and follow a standardized layout.

## Plugin Categories

### audio_interface
External, non-browsable music sources:
- Examples: Airplay, UPnP, Bluetooth, Equalizer, DSP
- **This is likely our category** - Sendspin provides external audio streaming

### music_service
Browsable music sources:
- Examples: MPD (local files), Webradios, Spotify, Deezer

### system_hardware
USB/Serial/GPIO peripherals, CPU controls, amplifiers

### system_controller
Core plugins for vital system functions (networking, NAS, updates)

### user_interface
External communication interfaces, APIs, visual interfaces

## Plugin Structure

### Installation Location
```
/data/plugins/{category}/{plugin_name}/
```

### Configuration Location
```
/data/configuration/{category}/{plugin_name}/config.json
```

### Plugin Status File
```
/data/plugins/plugins.json
```

Plugins must be registered in `plugins.json` with:
- `enabled`: boolean
- `status`: string ("STARTED", "STOPPED", etc.)

## Plugin Components

### Required Files
1. **index.js** - Main plugin entry point
2. **package.json** - Plugin metadata and dependencies
3. **UIConfig.json** - UI configuration page (optional)
4. **install.sh** - Installation script (if needed)

### Plugin Lifecycle
- Installation: Extract zip, run install.sh if present
- Enable/Disable: Controlled via plugins.json
- Start/Stop: Managed by Volumio plugin system

## Development Resources

### Documentation Links
- [Plugin System Overview](https://developers.volumio.com/plugins/plugins-overview)
- [Plugin Utility](https://developers.volumio.com/plugins/the-plugin-utility)
- [Plugin Structure](https://developers.volumio.com/plugins/the-plugin-structure)
- [Index.js](https://developers.volumio.com/plugins/index-js)
- [UI Configuration](https://developers.volumio.com/plugins/ui-configuration-page)

### Plugin Sources Repository
- Browse existing plugins for reference and inspiration
- Good way to understand plugin patterns

## Plugin Channels

### Stable Channel
- Available to all users
- Verified and tested plugins

### Beta Channel
- Available to beta testers
- Enable at: `http://{volumio_address}/dev` → "Plugins test mode"
- Allows testing before public release

## Key Considerations for Sendspin Plugin

### Audio Interface Plugin Pattern
Since Sendspin is an audio interface plugin (like Airplay/UPnP), we should:

1. **Audio Streaming**
   - Handle incoming Sendspin audio streams
   - Convert/transcode if needed for Volumio's audio pipeline
   - Manage playback state

2. **Device Discovery**
   - Discover Sendspin-compatible devices
   - Handle device connection/disconnection

3. **Control Interface**
   - Expose playback controls (play, pause, stop, volume)
   - Handle metadata updates
   - Sync with Volumio's state

4. **Configuration**
   - Plugin settings (port, discovery settings, etc.)
   - Device pairing/management

## Questions to Research

1. How do other audio_interface plugins work? (Airplay, UPnP examples)
2. How does Volumio handle audio routing?
3. What APIs are available for plugin-to-core communication?
4. How to integrate with Volumio's playback system?
5. What logging mechanisms are available?
6. How to handle plugin updates?

## Next Steps

- [ ] Review existing audio_interface plugins (Airplay, UPnP)
- [ ] Understand Volumio's audio pipeline
- [ ] Review plugin API documentation
- [ ] Study plugin structure examples
- [ ] Understand configuration management



