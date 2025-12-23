#!/bin/bash

# Sendspin Plugin Installation Script
# This script handles plugin installation and setup

echo "Starting Sendspin plugin installation..."

# Get plugin directory
PLUGIN_DIR=$(dirname "$0")

# Check if we're in the right directory
if [ ! -f "$PLUGIN_DIR/package.json" ]; then
    echo "Error: package.json not found in plugin directory"
    exit 1
fi

# Install Node.js dependencies
echo "Installing Node.js dependencies..."
cd "$PLUGIN_DIR"
npm install --omit=dev

if [ $? -ne 0 ]; then
    echo "Error: Failed to install Node.js dependencies"
    # Cleanup on failure
    rm -rf "$PLUGIN_DIR/node_modules"
    exit 1
fi

# Installation complete - no submodule build needed

# Verify installation
if [ ! -f "$PLUGIN_DIR/index.js" ]; then
    echo "Error: Plugin entry point not found"
    exit 1
fi

echo "Sendspin plugin installation completed successfully"
echo "plugininstallend"

