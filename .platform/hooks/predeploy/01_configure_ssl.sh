#!/bin/bash
set -e

LOG_FILE="/var/log/01_configure_ssl.log"

# Logging function
log_message() {
    echo "$(date +"%Y-%m-%d %H:%M:%S") - $1" | sudo tee -a $LOG_FILE > /dev/null
}

log_message "Starting 01_configure_ssl.sh script"

# Install EPEL and Certbot
log_message "Installing EPEL and Certbot"
sudo amazon-linux-extras install epel -y
sudo yum install -y certbot python2-certbot-nginx

# Stop Nginx to free up port 80
log_message "Stopping Nginx"
sudo systemctl stop nginx

# Obtain or renew the certificate for both domains
log_message "Obtaining or renewing the certificate"
if sudo certbot certonly --standalone -d carparkswap.com -d www.carparkswap.com --non-interactive --agree-tos --email paul@amplifygis.com; then
    log_message "Certbot certificate obtained successfully"
else
    log_message "Failed to obtain certificate with Certbot"
    exit 1
fi

# Remove any previous Certbot auto-renewal entries to avoid duplicates
log_message "Removing any previous Certbot auto-renewal entries"
sudo sed -i '/certbot renew/d' /etc/crontab

# Set up auto-renewal
log_message "Setting up auto-renewal for Certbot"
echo "0 0,12 * * * root python -c 'import random; import time; time.sleep(random.random() * 3600)' && certbot renew --quiet && systemctl reload nginx" | sudo tee -a /etc/crontab > /dev/null

# Validate the Nginx configuration to ensure no errors
log_message "Validating Nginx configuration"
if sudo nginx -t; then
    log_message "Nginx configuration is valid"
else
    log_message "Nginx configuration is invalid"
    exit 1
fi

# Restart Nginx to apply changes
log_message "Restarting Nginx"
sudo systemctl start nginx

log_message "Finished 01_configure_ssl.sh script"
