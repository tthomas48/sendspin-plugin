#!/bin/bash
# Sendspin Plugin Multi-Device Installation Script
# Reads device IPs from .env file
# 
# Usage:
#   1. cp .env.example .env
#   2. Edit .env with your device IPs
#   3. ./install-all.sh

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${RED}Error: .env file not found!${NC}"
    echo ""
    echo "Please create a .env file from .env.example:"
    echo "  cp .env.example .env"
    echo ""
    echo "Then edit .env and add your Volumio device IP addresses."
    exit 1
fi

# Load environment variables
export $(grep -v '^#' .env | xargs)

# Validate required variables
if [ -z "$VOLUMIO_DEVICE_1" ] && [ -z "$VOLUMIO_DEVICE_2" ] && [ -z "$VOLUMIO_DEVICE_3" ]; then
    echo -e "${RED}Error: No device IPs found in .env file!${NC}"
    echo "Please set at least VOLUMIO_DEVICE_1 in .env"
    exit 1
fi

# Set defaults
SSH_USER=${VOLUMIO_SSH_USER:-volumio}
PLUGIN_ZIP=${PLUGIN_PACKAGE:-sendspin-plugin.zip}

# Check if sshpass is available (needed for password auth)
SSHPASS_AVAILABLE=false
if [ -n "$VOLUMIO_SSH_PASSWORD" ]; then
    if command -v sshpass >/dev/null 2>&1; then
        SSHPASS_AVAILABLE=true
        echo -e "${GREEN}Using password authentication (sshpass found)${NC}"
    else
        echo -e "${YELLOW}Warning: sshpass not found but password is set in .env${NC}"
        echo "Install sshpass for password authentication:"
        echo "  sudo apt-get install sshpass  # Debian/Ubuntu/WSL"
        echo "  brew install hudochenkov/sshpass/sshpass  # macOS"
        echo ""
        echo "Or set up SSH keys for passwordless authentication."
        echo ""
        read -p "Continue without password authentication? (y/n) " -r response
        if [[ ! "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
            exit 1
        fi
    fi
else
    echo -e "${GREEN}Using SSH key authentication${NC}"
fi
echo ""

# Collect device IPs
DEVICES=()
[ -n "$VOLUMIO_DEVICE_1" ] && DEVICES+=("$VOLUMIO_DEVICE_1")
[ -n "$VOLUMIO_DEVICE_2" ] && DEVICES+=("$VOLUMIO_DEVICE_2")
[ -n "$VOLUMIO_DEVICE_3" ] && DEVICES+=("$VOLUMIO_DEVICE_3")

echo -e "${GREEN}Sendspin Plugin Multi-Device Installer${NC}"
echo "======================================"
echo ""
echo "Devices to install on:"
for i in "${!DEVICES[@]}"; do
    echo "  Device $((i+1)): ${DEVICES[$i]}"
done
echo ""
echo "SSH User: $SSH_USER"
echo "Plugin Package: $PLUGIN_ZIP"
echo ""

# Build sendspin-js submodule before packaging
if [ -d "lib/sendspin-js" ]; then
    echo "Building sendspin-js submodule..."
    if [ ! -f "lib/sendspin-js/dist/index.js" ]; then
        echo "Building TypeScript..."
        cd lib/sendspin-js
        if [ -f "package.json" ]; then
            npm install
            npm run build
            if [ $? -ne 0 ]; then
                echo -e "${RED}Failed to build sendspin-js submodule!${NC}"
                exit 1
            fi
        fi
        cd "$SCRIPT_DIR"
        echo -e "${GREEN}✓ Build complete${NC}"
    else
        echo -e "${GREEN}✓ sendspin-js already built${NC}"
    fi
fi

# Always rebuild the plugin zip
echo "Creating plugin package..."
if [ -f "$PLUGIN_ZIP" ]; then
    echo "Removing existing package: $PLUGIN_ZIP"
    rm -f "$PLUGIN_ZIP"
fi

zip -r "$PLUGIN_ZIP" . \
    -x "*.git*" \
    -x "node_modules/*" \
    -x "test/*" \
    -x "coverage/*" \
    -x "*.log" \
    -x ".env" \
    -x ".nvmrc" \
    -x "lib/sendspin-js/node_modules/*" \
    -x ".DS_Store" \
    -x "docs/*" \
    -x "test/*" \
    -x "coverage/*" \
    -x "*.log" \
    -x ".env" \
    -x ".nvmrc" \
    -x "lib/sendspin-js/node_modules/*" \
    -x ".DS_Store" \
    -x "docs/*" \
    -x "*.swp" \
    -x "*.zip" \
    -x "*.tar.gz" \
    -x "install-all.sh" \
    -x "lib/sendspin-js/src/*" \
    -x "lib/sendspin-js/tsconfig.json" \
    -x "lib/sendspin-js/.eslintrc*" \
    -x "lib/sendspin-js/.prettierrc*" || {
    echo -e "${RED}Failed to create plugin package!${NC}"
    exit 1
}
echo -e "${GREEN}Plugin package created: $PLUGIN_ZIP${NC}"

# Verify plugin package size
PACKAGE_SIZE=$(du -h "$PLUGIN_ZIP" | cut -f1)
echo "Plugin package size: $PACKAGE_SIZE"
echo ""

# Confirm installation
echo "Ready to install on ${#DEVICES[@]} device(s)."
echo "Press Enter to continue or Ctrl+C to cancel..."
read -r

# Install on each device
SUCCESS_COUNT=0
FAIL_COUNT=0

for IP in "${DEVICES[@]}"; do
    echo ""
    echo "=========================================="
    echo -e "${GREEN}Installing on device: $IP${NC}"
    echo "=========================================="
    
    # Test SSH connection
    echo "Testing SSH connection..."
    SSH_TEST_CMD="ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no"
    if [ "$SSHPASS_AVAILABLE" = true ]; then
        SSH_TEST_CMD="sshpass -p '$VOLUMIO_SSH_PASSWORD' $SSH_TEST_CMD"
    else
        SSH_TEST_CMD="$SSH_TEST_CMD -o BatchMode=yes"
    fi
    
    if ! eval "$SSH_TEST_CMD $SSH_USER@$IP exit" 2>/dev/null; then
        echo -e "${YELLOW}Warning: Cannot connect to $IP via SSH${NC}"
        echo "Make sure:"
        echo "  1. Device is on the network"
        echo "  2. SSH is enabled on Volumio"
        if [ "$SSHPASS_AVAILABLE" = false ]; then
            echo "  3. SSH keys are set up OR install sshpass and set password in .env"
        fi
        echo ""
        read -p "Continue anyway? (y/n) " -r response
        if [[ ! "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
            echo "Skipping $IP..."
            ((FAIL_COUNT++))
            continue
        fi
    else
        echo -e "${GREEN}✓ SSH connection successful${NC}"
    fi
    
    # Transfer plugin
    echo "Transferring plugin package..."
    SCP_CMD="scp -o StrictHostKeyChecking=no"
    if [ "$SSHPASS_AVAILABLE" = true ]; then
        SCP_CMD="sshpass -p '$VOLUMIO_SSH_PASSWORD' $SCP_CMD"
    fi
    
    if eval "$SCP_CMD $PLUGIN_ZIP $SSH_USER@$IP:/tmp/" 2>/dev/null; then
        echo -e "${GREEN}✓ Transfer complete${NC}"
    else
        echo -e "${RED}✗ Transfer failed${NC}"
        ((FAIL_COUNT++))
        continue
    fi
    
    # Install
    echo "Installing plugin..."
    SSH_CMD="ssh -o StrictHostKeyChecking=no"
    if [ "$SSHPASS_AVAILABLE" = true ]; then
        SSH_CMD="sshpass -p '$VOLUMIO_SSH_PASSWORD' $SSH_CMD"
    fi
    
    if eval "$SSH_CMD $SSH_USER@$IP" << 'INSTALL_EOF'
        set -e
        
        # Create plugin directory if it doesn't exist
        PLUGIN_DIR="/data/plugins/audio_interface"
        if [ ! -d "$PLUGIN_DIR" ]; then
            echo "Creating plugin directory: $PLUGIN_DIR"
            mkdir -p "$PLUGIN_DIR"
        fi
        
        cd "$PLUGIN_DIR"
        
        # Remove old installation if exists
        if [ -d "sendspin" ]; then
            echo "Removing old installation..."
            rm -rf sendspin
        fi
        
        # Extract plugin - check for unzip, install if needed, or use Python
        echo "Extracting plugin..."
        if command -v unzip >/dev/null 2>&1; then
            unzip -q /tmp/sendspin-plugin.zip -d sendspin
        elif command -v python3 >/dev/null 2>&1; then
            echo "unzip not found, using Python to extract..."
            python3 << 'PYTHON_EOF'
import zipfile
import os
os.makedirs('sendspin', exist_ok=True)
with zipfile.ZipFile('/tmp/sendspin-plugin.zip', 'r') as zip_ref:
    zip_ref.extractall('sendspin')
PYTHON_EOF
        elif command -v python >/dev/null 2>&1; then
            echo "unzip not found, using Python to extract..."
            python << 'PYTHON_EOF'
import zipfile
import os
os.makedirs('sendspin', exist_ok=True)
with zipfile.ZipFile('/tmp/sendspin-plugin.zip', 'r') as zip_ref:
    zip_ref.extractall('sendspin')
PYTHON_EOF
        else
            echo "Error: Neither unzip nor Python found. Trying to install unzip..."
            if command -v apt-get >/dev/null 2>&1; then
                sudo apt-get update && sudo apt-get install -y unzip
                if command -v unzip >/dev/null 2>&1; then
                    unzip -q /tmp/sendspin-plugin.zip -d sendspin
                else
                    echo "Error: Failed to install unzip"
                    exit 1
                fi
            else
                echo "Error: Cannot extract zip file. Please install unzip or Python."
                exit 1
            fi
        fi
        
        # Install
        cd sendspin
        chmod +x install.sh
        echo "Running install.sh..."
        ./install.sh
        
        # Cleanup
        rm -f /tmp/sendspin-plugin.zip
        
        echo "Installation complete!"
INSTALL_EOF
    then
        echo -e "${GREEN}✓ Installation on $IP complete!${NC}"
        
        # Restart Volumio
        echo "Restarting Volumio..."
        RESTART_CMD="ssh -o StrictHostKeyChecking=no"
        if [ "$SSHPASS_AVAILABLE" = true ]; then
            RESTART_CMD="sshpass -p '$VOLUMIO_SSH_PASSWORD' $RESTART_CMD"
        fi
        
        if eval "$RESTART_CMD $SSH_USER@$IP 'sudo systemctl restart volumio'" 2>/dev/null; then
            echo -e "${GREEN}✓ Volumio restart initiated on $IP${NC}"
        else
            echo -e "${YELLOW}⚠ Could not restart Volumio on $IP (may require manual restart)${NC}"
        fi
        
        ((SUCCESS_COUNT++))
    else
        echo -e "${RED}✗ Installation on $IP failed!${NC}"
        ((FAIL_COUNT++))
    fi
done

# Summary
echo ""
echo "=========================================="
echo -e "${GREEN}Installation Summary${NC}"
echo "=========================================="
echo -e "Successful: ${GREEN}$SUCCESS_COUNT${NC}"
echo -e "Failed: ${RED}$FAIL_COUNT${NC}"
echo ""

if [ $SUCCESS_COUNT -gt 0 ]; then
    echo "Next steps:"
    echo "1. Wait for Volumio to restart (may take 30-60 seconds)"
    echo "2. Open each Volumio device in browser: http://<device-ip>"
    echo "3. Go to Plugins -> My Plugins"
    echo "4. Find Sendspin and click the power button to enable (if not already enabled)"
    echo "5. Configure device names in plugin settings"
    echo ""
fi

if [ $FAIL_COUNT -gt 0 ]; then
    echo -e "${YELLOW}Some installations failed. Check the output above for details.${NC}"
    exit 1
fi

