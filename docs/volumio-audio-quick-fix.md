# Quick Fix for Your Volumio Audio Issues

## Immediate Steps

### 1. SSH into Your Volumio Device

```bash
ssh volumio@<your-device-ip>
```

### 2. Run Diagnostic Script

I've created a diagnostic script. Transfer it to your device:

```bash
# From your development machine
scp fix-volumio-audio.sh volumio@<device-ip>:/tmp/
ssh volumio@<device-ip> "chmod +x /tmp/fix-volumio-audio.sh && /tmp/fix-volumio-audio.sh"
```

### 3. Quick Manual Checks

```bash
# Check what audio devices exist
aplay -l

# Check mixer controls
amixer -c 0

# Check current config
cat /data/configuration/audio_interface/alsa_controller/config.json
```

## Most Likely Fix

Based on your errors, Volumio is trying to use `hw:1,0` which doesn't exist. Try:

### Option 1: Reset to Auto/Default

1. **Via Web UI:**
   - Go to `http://<device-ip>`
   - Settings → Playback Options
   - Set Audio Output to **Auto**
   - Save and restart

### Option 2: Manual Fix

```bash
# Backup config
cp /data/configuration/audio_interface/alsa_controller/config.json \
   /data/configuration/audio_interface/alsa_controller/config.json.backup

# Edit config
nano /data/configuration/audio_interface/alsa_controller/config.json
```

Change:
- `"outputdevice": "hw:1,0"` → `"outputdevice": "hw:0,0"` (or whatever `aplay -l` shows)
- `"mixer": "SoftMaster"` → `"mixer": "Master"` or `"PCM"` (check with `amixer -c 0`)

Then restart:
```bash
sudo systemctl restart volumio
```

## After Fixing

1. **Test audio:**
   ```bash
   aplay -D hw:0,0 /usr/share/sounds/alsa/Front_Left.wav
   ```

2. **Test Tidal:**
   - Try playing a track in Volumio UI
   - Check if sound works

3. **Check logs:**
   ```bash
   tail -f /var/log/volumio.log
   ```

Once audio is working, you can proceed with Sendspin plugin installation!



