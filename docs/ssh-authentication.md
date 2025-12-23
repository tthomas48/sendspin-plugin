# SSH Authentication Setup

## Password Authentication

If you're using password authentication (not SSH keys), you need to install `sshpass`:

### Install sshpass

**Debian/Ubuntu/WSL:**
```bash
sudo apt-get install sshpass
```

**macOS:**
```bash
brew install hudochenkov/sshpass/sshpass
```

### Configure .env

Add your password to `.env`:
```bash
VOLUMIO_SSH_PASSWORD=your_password_here
```

**Security Note**: The `.env` file is gitignored and won't be committed. However, be careful not to share it or commit it accidentally.

## SSH Key Authentication (Recommended)

For better security, set up SSH keys:

1. **Generate SSH key (if you don't have one):**
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   ```

2. **Copy key to Volumio device:**
   ```bash
   ssh-copy-id volumio@<device-ip>
   ```

3. **Test passwordless login:**
   ```bash
   ssh volumio@<device-ip>
   ```

4. **Remove password from .env** (or leave it empty)

The script will automatically use SSH keys if available, and fall back to password if `sshpass` is installed and password is set.

## Troubleshooting

### "Cannot connect via SSH"

1. **Check if device is reachable:**
   ```bash
   ping <device-ip>
   ```

2. **Test SSH manually:**
   ```bash
   ssh volumio@<device-ip>
   ```

3. **Check if password is correct:**
   - Verify password in `.env` file
   - Test manually: `ssh volumio@<device-ip>` (should prompt for password)

4. **Check if sshpass is installed:**
   ```bash
   which sshpass
   ```

5. **Enable SSH on Volumio:**
   - Volumio UI → Settings → System → Enable SSH

### "sshpass not found"

Install sshpass (see above) or set up SSH keys for passwordless authentication.



