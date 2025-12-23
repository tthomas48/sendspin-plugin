# Sendspin Volumio Plugin (Client/Player)

A Volumio plugin that enables Sendspin Protocol client/player functionality, allowing Volumio devices to connect to Sendspin servers (such as Music Assistant) for synchronized multi-room audio playback.

**Note:** This is a **Sendspin client/player** - it connects to Sendspin servers and receives audio streams. It does not act as a server.

## Features

- **Sendspin Protocol client** - Connects to Sendspin servers (e.g. Music Assistant)
- Receive and play Sendspin audio streams
- Automatic server discovery via mDNS
- Advertise player via mDNS for server discovery
- Multiple codec support (Opus, FLAC, PCM)
- Synchronized multi-room audio playback
- Playback control and metadata support
- Clock synchronization for low-latency streaming

## Installation

### Quick Start (Multiple Devices)

1. **Set up your device IPs:**
   ```bash
   cp .env.example .env
   # Edit .env with your actual Volumio device IPs
   nano .env
   ```

2. **Build and package:**
   ```bash
   npm run build-sendspin
   zip -r sendspin-plugin.zip . -x "*.git*" "node_modules/*" "test/*" "coverage/*" "*.log" ".env" "lib/sendspin-js/node_modules/*"
   ```

3. **Install on all devices:**
   ```bash
   ./install-all.sh
   ```

4. **Enable in Volumio UI:**
   - Open each device in browser
   - Go to **Plugins** → **My Plugins**
   - Find **Sendspin** and enable it
   - Configure device names in settings

### Manual Installation

See [INSTALL.md](INSTALL.md) for detailed manual installation instructions.

## Configuration

Configure the plugin through the Volumio UI:
- **Enable/disable Sendspin client**
- **Server Address** (optional - leave blank for auto-discovery via mDNS)
- **Device Name** (player name shown to Sendspin servers)

## Development

### Prerequisites

- Node.js >= 18.0.0 (Volumio runs v20.5.1)
- npm
- nvm (recommended for version management)

### Setup

```bash
# Use Node 20 to match Volumio (or nvm will auto-detect from .nvmrc)
source ~/.nvm/nvm.sh && nvm use

npm install
npm run build-sendspin
```

### Testing

```bash
npm test
```

### Project Structure

```
sendspin-plugin/
├── index.js              # Plugin entry point
├── package.json          # Plugin metadata
├── install.sh           # Installation script
├── install-all.sh       # Multi-device installer
├── .env.example         # Environment template
├── lib/
│   ├── index.js         # Main plugin controller
│   ├── sendspin-client.js # Sendspin Protocol client
│   ├── clock-sync.js    # Clock synchronization
│   ├── audio-scheduler.js # Audio scheduling
│   ├── audio-decoder.js # Audio decoding
│   ├── audio-player.js  # Audio playback via MPD
│   ├── UIConfig.json    # UI configuration
│   └── i18n/            # Translation files
└── docs/                # Documentation
```

## Documentation

- [Installation Guide](docs/installation-guide.md) - Detailed installation instructions
- [Implementation Status](docs/implementation-status.md) - Current development status
- [Compliance Checklist](docs/volumio-compliance-checklist.md) - Volumio submission requirements
- [Translation Guide](docs/translation-implementation.md) - Adding new languages

## Requirements

- Volumio 3.x
- Node.js >= 18.0.0 (Volumio currently runs v20.5.1 ✅)
- A Sendspin server (e.g. Music Assistant with Sendspin provider)
- Network connectivity for mDNS discovery and WebSocket connections

## License

Apache-2.0

## Development Note

This plugin was developed with AI assistance using Cursor and Claude.

## How It Works

This plugin implements a **Sendspin Protocol client/player**:

1. **mDNS Advertisement**: Advertises itself as a Sendspin player via mDNS so servers can discover it
2. **Server Discovery**: Automatically discovers Sendspin servers (e.g. Music Assistant) via mDNS
3. **WebSocket Connection**: Connects to the discovered server via WebSocket
4. **Protocol Handshake**: Performs Sendspin Protocol handshake (client/hello, server/hello)
5. **Clock Synchronization**: Synchronizes clocks with the server for low-latency streaming
6. **Audio Reception**: Receives and decodes audio streams (PCM, Opus, FLAC)
7. **Audio Playback**: Plays received audio through Volumio's MPD system
8. **Control**: Responds to volume and mute commands from the server

## Support

For issues and questions:
- Check logs: `/var/log/volumio.log`
- Review plugin logs in Volumio UI
- See [Troubleshooting](docs/installation-guide.md#troubleshooting) section
