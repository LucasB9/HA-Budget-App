#!/usr/bin/with-contenv bashio
# Starts the Household Budget server. Options are read by the server itself from /data/options.json.
bashio::log.info "Starting Household Budget..."
cd /app
exec node /app/server.mjs
