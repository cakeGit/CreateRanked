#!/bin/bash
# Start cron in the background
crond
# Start the Node.js app
exec node src/index.mjs
