#!/bin/bash
set -e  # Stop the script immediately if any command fails

echo "Navigating to project directory..."
cd "$(dirname "$0")"

echo "Pulling latest code from Git..."
git pull

echo "Installing production dependencies..."
npm ci --omit=dev

echo "Restarting bctonk service..."
sudo systemctl restart bctonk

echo "Deployment complete!"
