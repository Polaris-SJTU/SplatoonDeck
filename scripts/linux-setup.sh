#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y bluez bluez-tools usbutils dbus python3 python3-pip python3-venv python3-dbus libdbus-1-dev libdbus-glib-1-dev libglib2.0-dev
mkdir -p /opt/splatoondeck
python3 -m venv --system-site-packages /opt/splatoondeck/venv
/opt/splatoondeck/venv/bin/pip install --upgrade pip wheel setuptools
# The controller API does not use NXBT's obsolete optional Web/TUI packages.
/opt/splatoondeck/venv/bin/pip install --no-deps nxbt==0.1.4
/opt/splatoondeck/venv/bin/python -c "import nxbt; assert hasattr(nxbt, 'Nxbt')"
printf '[boot]\nsystemd=true\n' > /etc/wsl.conf
systemctl enable bluetooth.service
