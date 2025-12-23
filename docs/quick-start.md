# Quick Start Guide

## Installation on Multiple Volumio Devices

### Step 1: Set Up Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit with your device IPs
nano .env
```

Update the IP addresses in `.env`:
```bash
VOLUMIO_DEVICE_1=192.168.1.100  # Your first device
VOLUMIO_DEVICE_2=192.168.1.101  # Your second device
VOLUMIO_DEVICE_3=192.168.1.102  # Your third device
```

### Step 2: Build and Package

```bash
# Build the sendspin-js submodule
npm run build-sendspin

# Create plugin package (excludes .env and other dev files)
zip -r sendspin-plugin.zip . \
  -x "*.git*" \
  -x "node_modules/*" \
  -x "test/*" \
  -x "coverage/*" \
  -x "*.log" \
  -x ".env" \
  -x "*.zip" \
  -x "*.tar.gz"
```

### Step 3: Install on All Devices

```bash
# Run the automated installer
./install-all.sh
```

The script will:
- ✅ Read device IPs from `.env` file
- ✅ Check/create plugin package if needed
- ✅ Install on each device automatically
- ✅ Provide installation summary

### Step 4: Enable in Volumio UI

For each device:

1. Open `http://<device-ip>` in browser
2. Go to **Plugins** → **My Plugins**
3. Find **Sendspin** in the list
4. Click the **power button** to enable
5. Click **Start** if needed
6. Click the **gear icon** to configure:
   - Set device name (e.g., "Living Room", "Bedroom", "Kitchen")
   - Adjust other settings as needed
   - Click **Save**

### Step 5: Verify Installation

Check that each device:
- ✅ Shows "Running" status (green indicator)
- ✅ Is discoverable by Sendspin clients
- ✅ Can receive audio streams

## Troubleshooting

### Script Can't Connect

- Verify device IPs in `.env` are correct
- Ensure SSH is enabled on Volumio devices
- Check network connectivity: `ping <device-ip>`
- Test SSH manually: `ssh volumio@<device-ip>`

### Plugin Doesn't Appear

- Check installation completed: `ssh volumio@<device-ip> "ls -la /data/plugins/audio_interface/sendspin/"`
- Restart Volumio: `sudo systemctl restart volumio`
- Check logs: `tail -f /var/log/volumio.log | grep sendspin`

### Installation Fails

- Check Node.js version: `node --version` (needs >= 18.0.0, Volumio runs v20.5.1)
- Verify disk space: `df -h`
- Check permissions: `ls -la /data/plugins/audio_interface/`

## Next Steps

After successful installation:
- Test with Sendspin client (sendspin-cli or Music Assistant)
- Configure synchronized multi-room playback
- Test audio quality and latency

See [Installation Guide](installation-guide.md) for detailed instructions.

