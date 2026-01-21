#!/bin/bash
# Shared deployment script for staging and production
# Usage: ./scripts/deploy.sh [staging|production] [version]
#
# This script is called AFTER the workflow has already:
# - Cloned the repository
# - Checked out the correct branch/tag
# - Uploaded the app build to /tmp/app-build
#
# Environment variables required:
#   GOOGLE_CLIENT_ID, FACEBOOK_APP_ID, FACEBOOK_APP_SECRET
# Optional:
#   RELEASE_VERSION (for production)

set -e

ENV_TYPE="${1:-staging}"
RELEASE_VERSION="${2:-}"

echo "=== BrewOS Cloud Deployment Script ==="
echo "Environment: $ENV_TYPE"
echo "Version: ${RELEASE_VERSION:-latest}"
echo "Working directory: $(pwd)"

# Copy pre-built app from uploaded artifact
rm -rf web
mkdir -p web
# Handle case where SCP creates nested directory structure
if [ -d "/tmp/app-build/app-build" ]; then
  # Files are nested in app-build/app-build
  cp -r /tmp/app-build/app-build/* web/
elif [ -d "/tmp/app-build" ]; then
  # Files are directly in app-build
  cp -r /tmp/app-build/* web/
else
  echo "ERROR: /tmp/app-build not found!"
  exit 1
fi
rm -rf /tmp/app-build

# Set environment identifier
if [ "$ENV_TYPE" == "production" ]; then
  ENVIRONMENT_VALUE="cloud"
else
  ENVIRONMENT_VALUE="staging"
fi

# Create .env for cloud service
cat > .env << EOF
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
FACEBOOK_APP_ID=${FACEBOOK_APP_ID}
FACEBOOK_APP_SECRET=${FACEBOOK_APP_SECRET}
PORT=3001
DATA_DIR=/data
TRUST_PROXY=true
APP_DIST_PATH=/app/web
ENVIRONMENT=${ENVIRONMENT_VALUE}
EOF

# Update docker-compose.yml for deployment
# The app files are copied into the Docker image at /app/web during build
# So we should NOT mount ../web/dist:/app/web (that's the marketing site)
# and we should set APP_DIST_PATH=/app/web to use files from the image
if [ -f "docker-compose.yml" ]; then
  # Remove the volume mount for /app/web since files are in the image
  sed -i '/- \.\.\/web\/dist:\/app\/web:ro/d' docker-compose.yml
  
  # Remove the volume mount for /app/app/dist since we're using /app/web from image
  sed -i '/- \.\.\/app\/dist:\/app\/app\/dist:ro/d' docker-compose.yml
  
  # Add APP_DIST_PATH to environment section if not already present
  if ! grep -q "APP_DIST_PATH" docker-compose.yml; then
    # Insert APP_DIST_PATH after WEB_DIST_PATH line
    sed -i '/WEB_DIST_PATH/a\      - APP_DIST_PATH=/app/web' docker-compose.yml
  else
    # Update existing APP_DIST_PATH line
    sed -i 's|APP_DIST_PATH=.*|APP_DIST_PATH=/app/web|' docker-compose.yml
  fi
  
  # Add ENVIRONMENT to environment section if not already present
  if ! grep -q "ENVIRONMENT=" docker-compose.yml; then
    # Insert ENVIRONMENT after APP_DIST_PATH line
    sed -i "/APP_DIST_PATH/a\      - ENVIRONMENT=${ENVIRONMENT_VALUE}" docker-compose.yml
  else
    # Update existing ENVIRONMENT line
    sed -i "s|ENVIRONMENT=.*|ENVIRONMENT=${ENVIRONMENT_VALUE}|" docker-compose.yml
  fi
fi

# Build Admin UI
cd admin
npm ci
npm run build
cd ..

# Get version from package.json for logging
VERSION=$(node -p "require('./package.json').version")
echo "Building cloud service version: $VERSION"

# Cleanup disk space BEFORE building
echo "Cleaning up disk space..."
docker system prune -af --filter "until=1h" || true
docker builder prune -af || true
# Remove old node_modules caches
rm -rf /root/.npm/_cacache || true
# Show available disk space
df -h /

# Build Docker image
if [ -f "scripts/docker-build.sh" ]; then
  bash scripts/docker-build.sh
else
  docker build -t brewos-cloud:latest .
fi

# Tag image with version
docker tag brewos-cloud:latest brewos-cloud:$VERSION || true

# Restart service
docker compose down
docker compose up -d

# Wait for service to be healthy
echo "Waiting for service to start..."
sleep 5

for i in 1 2 3 4 5; do
  if curl -sf http://localhost:3001/api/health > /dev/null; then
    echo "✓ Service is healthy!"
    if [ "$ENV_TYPE" == "production" ] && [ -n "$RELEASE_VERSION" ]; then
      echo "  Deployed version: ${RELEASE_VERSION}"
    fi
    # Final cleanup after successful deploy
    docker system prune -af --filter "until=1h" || true
    docker builder prune -af || true
    echo "Disk space after cleanup:"
    df -h /
    exit 0
  fi
  echo "Waiting... ($i/5)"
  sleep 3
done

echo "✗ Health check failed!"
docker compose logs --tail=50
exit 1
