# Troubleshooting Volumio Audio Issues

## Your Current Errors

### ALSA Errors
```
ALSA lib control.c:1528:(snd_ctl_open_noupdate) Invalid CTL SoftMaster
mixer: Failed to read mixer for "alsa": failed to attach to SoftMaster: No such file or directory
ALSA lib control.c:1528:(snd_ctl_open_noupdate) Invalid CTL hw:1,0
mixer: Failed to read mixer for "alsa": failed to attach to hw:1,0: No such file or directory
```

### Zeroconf Warnings
```
zeroconf: No global port, disabling zeroconf
```

## Step-by-Step Troubleshooting

### Step 1: Check Available Audio Devices

SSH into your Volumio device and run:

```bash
# List all ALSA sound cards
aplay -l

# List all PCM devices
aplay -L

# Check ALSA mixer controls
amixer
```

**What to look for:**
- Note the card numbers (e.g., `card 0`, `card 1`)
- Note the device names
- Check if any devices are listed

### Step 2: Check Volumio Audio Configuration

1. **Via Web UI:**
   - Open Volumio web interface
   - Go to **Settings** → **Playback Options**
   - Check **Audio Output** settings
   - Note which device is selected

2. **Via Command Line:**
   ```bash
   # Check Volumio audio config
   cat /data/configuration/audio_interface/alsa_controller/config.json
   ```

### Step 3: Fix ALSA Configuration

The errors suggest Volumio is trying to use devices that don't exist:

#### Option A: Reset to Default Audio Device

1. **Via Web UI:**
   - Go to **Settings** → **Playback Options**
   - Set **Audio Output** to **Auto** or the first available device
   - Click **Save**
   - Restart Volumio: `sudo systemctl restart volumio`

2. **Via Command Line:**
   ```bash
   # Find the default/correct audio device
   aplay -l
   
   # Edit Volumio config (backup first!)
   cp /data/configuration/audio_interface/alsa_controller/config.json \
      /data/configuration/audio_interface/alsa_controller/config.json.backup
   
   # Edit config - set outputdevice to a valid device
   nano /data/configuration/audio_interface/alsa_controller/config.json
   ```

   Look for and update:
   ```json
   {
     "outputdevice": "hw:0,0",  // Use card 0, device 0 (adjust based on aplay -l output)
     "mixer": "Digital"  // or "Master" or "PCM" - check with amixer
   }
   ```

#### Option B: Create SoftMaster (if needed)

If your audio device doesn't have a mixer control, you might need to create a software mixer:

```bash
# Check if snd-aloop is loaded
lsmod | grep snd_aloop

# Load ALSA loopback module (if not loaded)
sudo modprobe snd-aloop

# Make it persistent
echo "snd-aloop" | sudo tee -a /etc/modules
```

### Step 4: Fix Specific Errors

#### Error: "Invalid CTL SoftMaster"

This means Volumio is trying to use a software mixer that doesn't exist.

**Solution:**
```bash
# Check what mixer controls are available
amixer -c 0  # Replace 0 with your card number

# Update Volumio config to use an existing mixer
# Common mixers: "Master", "PCM", "Digital", "Speaker"
```

Edit `/data/configuration/audio_interface/alsa_controller/config.json`:
```json
{
  "mixer": "Master"  // or "PCM" or "Digital" - use what amixer shows
}
```

#### Error: "Invalid CTL hw:1,0"

This means Volumio is trying to use audio card 1, device 0, which doesn't exist.

**Solution:**
```bash
# Check what cards actually exist
aplay -l

# Update config to use correct card/device
# Example: if only card 0 exists, use "hw:0,0"
```

Edit `/data/configuration/audio_interface/alsa_controller/config.json`:
```json
{
  "outputdevice": "hw:0,0"  // Use the card/device from aplay -l
}
```

### Step 5: Test Audio Output

```bash
# Test audio with aplay
aplay -D hw:0,0 /usr/share/sounds/alsa/Front_Left.wav

# Or test with speaker-test
speaker-test -c 2 -t wav -D hw:0,0
```

### Step 6: Restart Volumio Services

```bash
# Restart Volumio
sudo systemctl restart volumio

# Check status
sudo systemctl status volumio

# Check logs
tail -f /var/log/volumio.log
```

### Step 7: Fix Zeroconf (Optional)

The zeroconf warnings are less critical but can be fixed:

```bash
# Check if port is configured
cat /data/configuration/system_controller/network/config.json | grep -i port

# Zeroconf should work automatically, but you can check:
systemctl status avahi-daemon
```

## Quick Fix Script

Save this as `fix-volumio-audio.sh` and run on your Volumio device:

```bash
#!/bin/bash
echo "=== Volumio Audio Troubleshooting ==="
echo ""

echo "1. Checking audio devices..."
aplay -l
echo ""

echo "2. Checking ALSA mixer controls..."
amixer -c 0
echo ""

echo "3. Current Volumio audio config:"
cat /data/configuration/audio_interface/alsa_controller/config.json | python -m json.tool
echo ""

echo "4. Testing audio output..."
echo "If you hear sound, audio hardware is working."
aplay -D hw:0,0 /usr/share/sounds/alsa/Front_Left.wav 2>/dev/null || echo "Test file not found, skipping audio test"
echo ""

echo "=== Recommendations ==="
echo "1. Note the card/device from 'aplay -l' output"
echo "2. Note available mixer from 'amixer -c 0' output"
echo "3. Update Volumio config with correct values"
echo "4. Restart Volumio: sudo systemctl restart volumio"
```

## Common Solutions by Device Type

### USB DAC
- Usually `hw:1,0` or `hw:2,0`
- Mixer might be "Digital" or "PCM"
- Check: `aplay -l` to find correct card

### Built-in Audio (Raspberry Pi)
- Usually `hw:0,0`
- Mixer: "PCM" or "Master"
- May need: `sudo raspi-config` → Advanced → Audio → Force 3.5mm

### HDMI Audio
- Usually `hw:0,1` or `hw:1,0`
- Mixer: "PCM" or "HDMI"
- Check: `tvservice -s` to verify HDMI connection

### I2S DAC (HAT)
- Usually `hw:0,0`
- Mixer: Check device-specific documentation
- May need device tree overlay enabled

## After Fixing

Once audio is working:

1. **Test Tidal:**
   - Try playing a Tidal track
   - Check if sound comes through
   - Verify casting works

2. **Verify for Sendspin Plugin:**
   - Audio must be working before installing Sendspin plugin
   - Sendspin plugin captures audio from Volumio's playback
   - If Volumio can't play audio, Sendspin can't capture it

3. **Check Logs:**
   ```bash
   tail -f /var/log/volumio.log | grep -i "audio\|alsa\|mixer"
   ```

## Still Having Issues?

1. **Check Volumio version:**
   ```bash
   cat /etc/os-release
   ```

2. **Check hardware:**
   ```bash
   # List all hardware
   lspci | grep -i audio
   lsusb | grep -i audio
   ```

3. **Check ALSA configuration:**
   ```bash
   cat /etc/asound.conf
   cat ~/.asoundrc
   ```

4. **Reset to defaults:**
   ```bash
   # Backup current config
   cp -r /data/configuration /data/configuration.backup
   
   # Reset audio config (will use defaults)
   rm /data/configuration/audio_interface/alsa_controller/config.json
   sudo systemctl restart volumio
   ```

## Next Steps

Once audio is working:
- ✅ Test Tidal playback
- ✅ Test Tidal casting
- ✅ Verify all audio outputs work
- ✅ Then proceed with Sendspin plugin installation



