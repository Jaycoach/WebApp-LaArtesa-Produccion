#!/bin/bash
set -euo pipefail
REPO="$HOME/LaArtesa"
sudo cp "$REPO/deployment/security/fail2ban-jail.conf"       /etc/fail2ban/jail.d/nginx-artesa.conf
sudo cp "$REPO/deployment/security/fail2ban-filter-4xx.conf" /etc/fail2ban/filter.d/nginx-4xx.conf
sudo systemctl enable fail2ban
sudo systemctl restart fail2ban
sleep 3
sudo fail2ban-client status
echo "✓ fail2ban aplicado"
