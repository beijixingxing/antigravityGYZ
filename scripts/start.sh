#!/bin/sh
echo "=== Starting Gemini Proxy (Enhanced Start) ==="

# Print working directory
pwd
ls -la

# Wait for database to be ready
echo "Waiting for database..."
sleep 5

# Run database sync
echo "Running Prisma DB Push..."
# Try to run db push and capture output
if npx prisma db push --accept-data-loss; then
    echo "DB Push Successful!"
else
    echo "DB Push FAILED!"
    # Don't exit, try to start anyway, maybe it works?
fi

# Start the application
echo "Starting application..."
exec node dist/app.js
