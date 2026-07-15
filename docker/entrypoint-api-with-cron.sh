#!/bin/sh
set -e
cron
cd /app/apps/api
exec sh -c "npx prisma migrate deploy && node dist/index.js"
