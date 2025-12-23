# Troubleshooting Sendspin Device Discovery

If your Volumio device isn't showing up in Music Assistant, follow these troubleshooting steps:

## Step 1: Check Plugin Status

1. **Check if the plugin is running:**
   ```bash
   # SSH into your Volumio device
   ssh volumio@<device-ip>
   
   # Check plugin status
   cat /data/plugins/plugins.json | grep -A 5 sendspin
   ```
   
   You should see:
   ```json
   "sendspin": {
     "enabled": true,
     "status": "STARTED"
   }
   ```

2. **Check plugin logs:**
   ```bash
   # View Volumio logs (filter for Sendspin)
   tail -f /var/log/volumio.log | grep -i sendspin
   ```
   
   Or check the full log:
   ```bash
   tail -n 100 /var/log/volumio.log | grep -i sendspin
   ```

## Step 2: Verify WebSocket Server is Running

1. **Check if the port is listening:**
   ```bash
   # Default port is 8080, adjust if you changed it
   netstat -tlnp | grep 8080
   # or
   ss -tlnp | grep 8080
   ```
   
   You should see something like:
   ```
   tcp  0  0  0.0.0.0:8080  0.0.0.0:*  LISTEN  <pid>/node
   ```

2. **Test WebSocket connection locally:**
   ```bash
   # Test if the server responds
   curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
        -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: test" \
        http://localhost:8080/
   ```

## Step 3: Check mDNS/Bonjour Advertising

1. **Verify Bonjour service is advertising:**
   ```bash
   # Install avahi-utils if not available
   sudo apt-get install avahi-utils
   
   # Browse for Sendspin services
   avahi-browse -t _sendspin._tcp
   ```
   
   You should see your device listed.

2. **Check service details:**
   ```bash
   # Get detailed service info
   avahi-browse -v -t _sendspin._tcp
   ```

3. **Verify service name:**
   ```bash
   # Check what name the service is advertising
   avahi-browse -r _sendspin._tcp
   ```

## Step 4: Network and Firewall Checks

1. **Verify network connectivity:**
   ```bash
   # From your Music Assistant device, ping the Volumio device
   ping <volumio-ip>
   ```

2. **Check firewall rules:**
   ```bash
   # On Volumio device, check if firewall is blocking port 8080
   sudo iptables -L -n | grep 8080
   # or
   sudo ufw status | grep 8080
   ```

3. **Test port accessibility from Music Assistant:**
   ```bash
   # From Music Assistant device
   telnet <volumio-ip> 8080
   # or
   nc -zv <volumio-ip> 8080
   ```

## Step 5: Check Plugin Configuration

1. **Verify configuration values:**
   ```bash
   # Check plugin config
   cat /data/configuration/audio_interface/sendspin/config.json
   ```
   
   Should contain:
   ```json
   {
     "enabled": true,
     "port": 8080,
     "device_name": "Volumio",
     "capture_method": "auto",
     "preferred_codec": "opus"
   }
   ```

2. **Check if device name is set correctly:**
   - The device name should be unique and not contain special characters
   - Default is "Volumio" which might conflict if you have multiple devices

## Step 6: Restart the Plugin

1. **Restart the plugin:**
   - Via UI: Disable and re-enable the plugin
   - Via SSH:
     ```bash
     # Stop
     volumio plugin disable sendspin
     # Start
     volumio plugin enable sendspin
     ```

2. **Restart Volumio (if needed):**
   ```bash
   sudo reboot
   ```

## Step 7: Check Music Assistant Configuration

1. **Verify Music Assistant can discover devices:**
   - Check Music Assistant logs for discovery messages
   - Ensure Music Assistant is on the same network
   - Check if other Sendspin devices are discoverable

2. **Manual connection test:**
   - Try manually adding the device in Music Assistant using:
     - IP: `<volumio-ip>`
     - Port: `8080`

## Common Issues

### Issue: Plugin shows as "STARTED" but port not listening
**Solution:** Check logs for startup errors. The server might have failed to start.

### Issue: mDNS not advertising
**Solution:** 
- Check if `bonjour` package is installed: `npm list bonjour`
- Check logs for Bonjour errors
- Verify network interface is up: `ip addr show`

### Issue: Service visible locally but not externally
**Symptoms:** `avahi-browse -t _sendspin._tcp` works on the Volumio device but not from other devices.

**Possible Causes:**
1. **Firewall blocking mDNS (UDP port 5353)**
   ```bash
   # Check firewall status
   sudo ufw status
   # Allow mDNS
   sudo ufw allow 5353/udp
   ```

2. **Network isolation (AP Isolation)**
   - Check router settings for "AP Isolation" or "Client Isolation"
   - Disable if enabled (prevents devices from seeing each other)

3. **Multicast not enabled on router**
   - Check router settings for "Multicast" or "IGMP" options
   - Enable IGMP snooping if available

4. **Different network segments**
   - mDNS only works within the same subnet/VLAN
   - Ensure all devices are on the same network segment
   - Check IP addresses: `ip addr show`

5. **avahi-daemon configuration**
   ```bash
   # Check avahi is running
   sudo systemctl status avahi-daemon
   
   # Check avahi config
   cat /etc/avahi/avahi-daemon.conf
   # Ensure 'allow-interfaces' includes your network interface
   ```

**Verification:**
```bash
# Test from another device on the same network
avahi-browse -t _sendspin._tcp

# Check service name (should be hostname, not "Volumio")
hostname
```

### Issue: Port 8080 already in use
**Solution:**
- Change port in plugin settings
- Or find what's using it: `sudo lsof -i :8080`

### Issue: Firewall blocking connections
**Solution:**
- Open port 8080 in firewall
- Or disable firewall temporarily to test: `sudo ufw disable` (re-enable after testing!)

### Issue: Device name conflicts
**Solution:**
- Change device name in plugin settings to something unique
- Restart plugin after changing name

## Debug Mode

To get more detailed logging, you can modify the plugin to increase log verbosity. Check the logs for:
- `[Sendspin] Starting Sendspin plugin...`
- `[Sendspin] Sendspin plugin started`
- `[Sendspin] mDNS service advertising...`
- Any error messages

## Still Not Working?

If none of these steps resolve the issue:

1. **Collect debug information:**
   ```bash
   # Plugin status
   cat /data/plugins/plugins.json | grep -A 5 sendspin > debug.txt
   
   # Recent logs
   tail -n 200 /var/log/volumio.log | grep -i sendspin >> debug.txt
   
   # Network status
   netstat -tlnp | grep 8080 >> debug.txt
   avahi-browse -t _sendspin._tcp >> debug.txt
   
   # Configuration
   cat /data/configuration/audio_interface/sendspin/config.json >> debug.txt
   ```

2. **Check the plugin code:**
   - Verify `lib/sendspin-js/dist/index.js` exists and is built
   - Check that all dependencies are installed: `npm list` in plugin directory

3. **Test with a simple WebSocket client:**
   - Use a WebSocket testing tool to connect directly to `ws://<volumio-ip>:8080`
   - This will help determine if it's a discovery issue or a connection issue

