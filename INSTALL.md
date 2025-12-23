# Quick Installation Guide

## For 3 Volumio Devices

### Preparation (Do Once)

1. **Build the plugin:**
   ```bash
   npm run build-sendspin
   ```

2. **Create plugin package:**
   ```bash
   zip -r sendspin-plugin.zip . -x "*.git*" "node_modules/*" "test/*" "coverage/*" "*.log"
   ```

### Installation (Repeat for Each Device)

For each Volumio device (replace `<device-ip>` with actual IP):

1. **Transfer plugin:**
   ```bash
   scp sendspin-plugin.zip volumio@<device-ip>:/tmp/
   ```

2. **SSH into device:**
   ```bash
   ssh volumio@<device-ip>
   ```

3. **Install:**
   ```bash
   cd /data/plugins/audio_interface
   unzip /tmp/sendspin-plugin.zip -d sendspin
   cd sendspin
   chmod +x install.sh
   ./install.sh
   ```

4. **Enable in UI:**
   - Open `http://<device-ip>` in browser
   - Go to **Plugins** → **My Plugins**
   - Find **Sendspin** and click power button to enable
   - Click **Start**

5. **Configure:**
   - Click gear icon next to Sendspin
   - Set device name (e.g., "Volumio Living Room")
   - Save settings

### Quick Script (Automated)

1. **Set up your device IPs:**
   ```bash
   cp .env.example .env
   # Edit .env with your actual device IPs
   nano .env
   ```

2. **Run the installation script:**
   ```bash
   ./install-all.sh
   ```

The script (`install-all.sh`) will:
- Read device IPs from `.env` file (gitignored, won't be committed)
- Check/create plugin package if needed
- Install on all devices automatically
- Provide installation summary

**Note:** Make sure SSH keys are set up or configure password in `.env`

See `docs/installation-guide.md` for detailed instructions.

