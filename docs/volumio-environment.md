# Volumio Environment Information

## Node.js Version

**Current Volumio Node.js Version**: v20.5.1

This plugin has been tested and verified to work with Volumio's Node.js v20.5.1 environment.

## Compatibility

- **Minimum Node.js**: 18.0.0 (for @discordjs/opus support)
- **Volumio Node.js**: 20.5.1 ✅ (fully compatible)
- **Recommended**: Node.js 18+ for best performance

## Development Environment

When developing this plugin, ensure you're using a compatible Node.js version:

```bash
# Use Node.js LTS (recommended)
nvm use --lts

# Or use Node 20 to match Volumio
nvm use 20
```

## Plugin Requirements

The plugin requires:
- Node.js >= 18.0.0 (for @discordjs/opus native encoding)
- Volumio 3.x
- PulseAudio or ALSA (for audio capture)
- ffmpeg or flac (optional, for encoding fallbacks)

## Notes

- Volumio v20.5.1 fully supports @discordjs/opus (no fallback needed)
- All native encoding features work without issues
- No compatibility shims required



