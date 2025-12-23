# Sendspin Plugin Installation Guide

## Prerequisites

Before installing on your Volumio devices, you need to prepare the plugin package.

### Step 1: Build the Plugin

1. **Navigate to the plugin directory:**
   ```bash
   cd /path/to/sendspin-plugin
   ```

2. **Build the sendspin-js submodule:**
   ```bash
   npm run build-sendspin
   ```
   
   This compiles the TypeScript server code in the submodule. You should see output indicating successful compilation.

3. **Verify the build:**
   ```bash
   ls -la lib/sendspin-js/dist/
   ```
   
   You should see `index.js` and other compiled files.

### Step 2: Package the Plugin

1. **Create a plugin archive:**
   ```bash
   # Create a zip file excluding development files
   zip -r sendspin-plugin.zip . \
     -x "*.git*" \
     -x "node_modules/*" \
     -x "test/*" \
     -x "coverage/*" \
     -x "*.log" \
     -x ".DS_Store" \
     -x "*.swp"
   ```

   **OR** use tar:
   ```bash
   tar -czf sendspin-plugin.tar.gz \
     --exclude='.git' \
     --exclude='node_modules' \
     --exclude='test' \
     --exclude='coverage' \
     --exclude='*.log' \
     .
   ```

2. **Verify archive size:**
   ```bash
   ls -lh sendspin-plugin.zip
   ```
   
   Should be less than 10 MB (typically 100-500 KB).

## Installation Methods

### Method 1: Manual Installation (Recommended for Testing)

This method works for testing and development.

#### Step 1: Access Your Volumio Device

1. **SSH into your Volumio device:**
   ```bash
   ssh volumio@<volumio-ip-address>
   ```
   
   Default password is usually `volumio` (change it if needed).

2. **Navigate to plugins directory:**
   ```bash
   cd /data/plugins/audio_interface
   ```

#### Step 2: Transfer the Plugin

**Option A: Using SCP (from your development machine):**
```bash
scp sendspin-plugin.zip volumio@<volumio-ip>:/tmp/
```

**Option B: Using wget/curl (if you host the file):**
```bash
# On Volumio device
cd /tmp
wget http://your-server/sendspin-plugin.zip
```

**Option C: Using USB drive:**
1. Copy `sendspin-plugin.zip` to a USB drive
2. Insert USB into Volumio device
3. Mount and copy (usually at `/media/USB/`)

#### Step 3: Extract and Install

1. **Extract the plugin:**
   ```bash
   cd /data/plugins/audio_interface
   unzip /tmp/sendspin-plugin.zip -d sendspin
   # OR if using tar:
   tar -xzf /tmp/sendspin-plugin.tar.gz -C sendspin
   ```

2. **Set permissions:**
   ```bash
   cd sendspin
   chmod +x install.sh
   ```

3. **Run installation script:**
   ```bash
   ./install.sh
   ```
   
   This will:
   - Install Node.js dependencies via `npm install`
   - Build the sendspin-js submodule if needed
   - Verify installation

4. **Verify installation:**
   ```bash
   ls -la /data/plugins/audio_interface/sendspin/
   ```
   
   Should see: `index.js`, `package.json`, `lib/`, etc.

#### Step 4: Enable the Plugin

1. **Via Volumio UI:**
   - Open Volumio web interface: `http://<volumio-ip>`
   - Go to **Plugins** → **My Plugins**
   - Find **Sendspin** in the list
   - Click the **power button** to enable it
   - Click **Start** if it doesn't start automatically

2. **Via Command Line (alternative):**
   ```bash
   # Edit plugins.json
   nano /data/plugins/plugins.json
   ```
   
   Find or add entry:
   ```json
   {
     "audio_interface": {
       "sendspin": {
         "enabled": true,
         "status": "STARTED"
       }
     }
   }
   ```
   
   Then restart Volumio or the plugin system.

### Method 2: Plugin Store Installation (Future)

Once the plugin is published to the Volumio Plugin Store:

1. Open Volumio web interface
2. Go to **Plugins** → **Available Plugins**
3. Search for "Sendspin"
4. Click **Install**
5. Wait for installation to complete
6. Click **Enable** and **Start**

## Post-Installation Configuration

### Step 1: Access Plugin Settings

1. Open Volumio web interface
2. Go to **Plugins** → **My Plugins**
3. Click the **gear icon** next to Sendspin
4. Configure settings:
   - **Enable Sendspin**: Toggle on/off
   - **WebSocket Port**: Default 8080 (change if needed)
   - **Device Name**: Name shown to Sendspin clients
   - **Audio Capture Method**: Auto/PulseAudio/ALSA
   - **Preferred Codec**: Opus/FLAC/PCM

### Step 2: Verify Installation

1. **Check plugin status:**
   - In Volumio UI, plugin should show as "Running" (green indicator)

2. **Check logs:**
   ```bash
   # On Volumio device
   tail -f /var/log/volumio.log | grep -i sendspin
   ```
   
   Should see messages like:
   ```
   [Sendspin] Starting Sendspin plugin...
   [Sendspin] Sendspin plugin started
   ```

3. **Test WebSocket server:**
   ```bash
   # From another machine
   curl http://<volumio-ip>:8080
   ```
   
   Should get a WebSocket upgrade response (or connection refused if firewall blocks it).

4. **Check mDNS discovery:**
   ```bash
   # From another machine on same network
   avahi-browse -a | grep sendspin
   ```
   
   Should see the Sendspin service advertised.

## Installation on Multiple Devices

### Repeat for Each Device

For each of your 3 Volumio devices:

1. **Device 1:**
   - Follow steps above
   - Set device name: "Volumio Living Room" (or your preference)
   - Note the IP address

2. **Device 2:**
   - Follow steps above
   - Set device name: "Volumio Bedroom" (or your preference)
   - Use different port if needed (e.g., 8081)

3. **Device 3:**
   - Follow steps above
   - Set device name: "Volumio Kitchen" (or your preference)
   - Use different port if needed (e.g., 8082)

### Quick Installation Script

Use the provided `install-all.sh` script for automated installation:

1. **Set up your device IPs:**
   ```bash
   cp .env.example .env
   nano .env  # Edit with your device IPs
   ```

2. **Build and package the plugin:**
   ```bash
   npm run build-sendspin
   zip -r sendspin-plugin.zip . -x "*.git*" "node_modules/*" "test/*" "coverage/*" "*.log" ".env"
   ```

3. **Run the installation script:**
   ```bash
   ./install-all.sh
   ```

The script will:
- Read device IPs from `.env` file
- Check if plugin package exists (create if needed)
- Install on each device automatically
- Provide installation summary

**Note:** The `.env` file is gitignored and won't be committed to version control.

## Troubleshooting

### Plugin Doesn't Appear in UI

1. **Check plugin directory:**
   ```bash
   ls -la /data/plugins/audio_interface/sendspin/
   ```

2. **Check package.json:**
   ```bash
   cat /data/plugins/audio_interface/sendspin/package.json | grep volumio_info
   ```

3. **Restart Volumio:**
   ```bash
   sudo systemctl restart volumio
   ```

### Plugin Fails to Start

1. **Check logs:**
   ```bash
   tail -100 /var/log/volumio.log | grep -i sendspin
   ```

2. **Check Node.js version:**
   ```bash
   node --version
   ```
   
   Should be >= 18.0.0 (Volumio currently runs v20.5.1)

3. **Check dependencies:**
   ```bash
   cd /data/plugins/audio_interface/sendspin
   npm list
   ```

4. **Rebuild submodule:**
   ```bash
   cd /data/plugins/audio_interface/sendspin
   npm run build-sendspin
   ```

### WebSocket Port Already in Use

1. **Check what's using the port:**
   ```bash
   sudo netstat -tulpn | grep 8080
   ```

2. **Change port in plugin settings:**
   - Use a different port (e.g., 8081, 8082)
   - Update in Volumio UI settings

### Audio Capture Not Working

1. **Check if PulseAudio is available:**
   ```bash
   which parec
   ```

2. **Check if ALSA is available:**
   ```bash
   which arecord
   ```

3. **Try different capture method:**
   - Change "Audio Capture Method" in plugin settings
   - Try "Auto", "PulseAudio", or "ALSA"

## Verification Checklist

After installation on each device:

- [ ] Plugin appears in Volumio UI
- [ ] Plugin can be enabled/started
- [ ] Plugin shows "Running" status
- [ ] No errors in logs
- [ ] WebSocket server is listening (check with `netstat`)
- [ ] mDNS service is advertised (check with `avahi-browse`)
- [ ] Configuration page loads correctly
- [ ] Settings can be saved

## Next Steps

After successful installation:

1. **Test with Sendspin client:**
   - Use `sendspin-cli` or Music Assistant
   - Discover your Volumio devices
   - Test audio streaming

2. **Configure multi-room:**
   - Set up synchronized playback across devices
   - Test volume control
   - Test metadata display

3. **Monitor performance:**
   - Check CPU usage
   - Monitor network bandwidth
   - Verify audio quality

## Support

If you encounter issues:

1. Check the logs: `/var/log/volumio.log`
2. Review plugin logs in Volumio UI
3. Verify all prerequisites are met
4. Check network connectivity
5. Ensure firewall allows WebSocket connections

