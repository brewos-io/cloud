# BrewOS Cloud

<p align="center">
  <img src="https://raw.githubusercontent.com/brewos-io/firmware/main/assets/1080/horizontal/full-color/Brewos-1080.png" alt="BrewOS Logo" width="300">
</p>

<p align="center">
  <strong>Cloud service for BrewOS remote access</strong>
</p>

<p align="center">
  <a href="#overview">Overview</a> •
  <a href="#features">Features</a> •
  <a href="#setup">Setup</a> •
  <a href="#deployment">Deployment</a> •
  <a href="#api">API</a>
</p>

---

## Overview

BrewOS Cloud is a WebSocket relay service that enables secure remote access to BrewOS espresso machines. It provides authentication, device pairing, push notifications, and serves the BrewOS Progressive Web App.

### Key Features

- 🔐 **Google OAuth** - Secure authentication
- 🔗 **WebSocket Relay** - Real-time bidirectional communication
- 📱 **Push Notifications** - Web Push API support
- 🎛️ **Admin Dashboard** - Monitor and manage connected devices
- 💾 **SQLite Database** - Device and user management
- 🚀 **Express Server** - RESTful API endpoints
- 📦 **Docker Support** - Containerized deployment

---

## Architecture

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Browser   │◄───────►│  Cloud       │◄───────►│   ESP32      │
│   (PWA)     │  WSS    │  Service     │   WS    │   Device     │
└─────────────┘         └──────────────┘         └─────────────┘
                              │
                              ▼
                        ┌──────────────┐
                        │   SQLite DB   │
                        └──────────────┘
```

The cloud service acts as a relay:
1. Client (browser) connects via secure WebSocket (WSS)
2. ESP32 device connects via WebSocket (WS)
3. Cloud service relays messages between client and device
4. Authentication and authorization handled by cloud service

---

## Setup

### Prerequisites

- Node.js 18+
- npm or yarn
- Google OAuth credentials (for authentication)
- VAPID keys (for push notifications)

### Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp env.example .env
```

### Environment Variables

Edit `.env` file with your configuration:

```env
# Server
PORT=3001
NODE_ENV=production

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback

# Database
DB_PATH=./data/brewos.db

# Push Notifications
VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key
VAPID_SUBJECT=mailto:your-email@example.com

# CORS
ALLOWED_ORIGINS=https://cloud.brewos.io,https://brewos.io

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URIs
6. Copy Client ID and Secret to `.env`

### VAPID Keys (Push Notifications)

Generate VAPID keys:

```bash
npm install -g web-push
web-push generate-vapid-keys
```

Copy the keys to your `.env` file.

---

## Development

```bash
# Start development server with hot reload
npm run dev

# Build TypeScript
npm run build

# Build admin dashboard
npm run build:admin

# Build everything
npm run build:all

# Start production server
npm start

# Lint code
npm run lint
```

### Development Server

The dev server runs on `http://localhost:3001` with:
- Hot reload for TypeScript changes
- WebSocket support
- Admin dashboard at `/admin`

---

## Deployment

### Docker

```bash
# Build image
docker build -t brewos-cloud .

# Run container
docker run -p 3001:3001 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/.env:/app/.env \
  brewos-cloud
```

### Docker Compose

```bash
docker-compose up -d
```

### Manual Deployment

1. Build the project:

```bash
npm run build:all
```

2. Start the server:

```bash
npm start
```

Or use PM2 for process management:

```bash
pm2 start dist/server.js --name brewos-cloud
```

---

## API Endpoints

### Authentication

- `GET /auth/google` - Initiate Google OAuth
- `GET /auth/google/callback` - OAuth callback
- `GET /auth/logout` - Logout
- `GET /auth/me` - Get current user

### Device Management

- `GET /api/devices` - List user's devices
- `POST /api/devices/pair` - Pair a new device
- `DELETE /api/devices/:id` - Unpair device
- `GET /api/devices/:id/status` - Get device status

### WebSocket

- `WS /ws` - WebSocket connection for device relay
- `WS /ws/device/:deviceId` - Device connection endpoint

### Admin (if enabled)

- `GET /admin` - Admin dashboard
- `GET /api/admin/devices` - List all devices
- `GET /api/admin/users` - List all users
- `GET /api/admin/stats` - System statistics

---

## Project Structure

```
cloud/
├── src/
│   ├── server.ts          # Main server entry point
│   ├── client-proxy.ts    # WebSocket client proxy
│   ├── device-relay.ts    # Device WebSocket relay
│   ├── routes/            # Express routes
│   ├── services/          # Business logic
│   ├── middleware/        # Express middleware
│   └── lib/               # Utilities
├── admin/                 # Admin dashboard (React)
├── docker-compose.yml     # Docker Compose config
├── Dockerfile             # Docker image
└── package.json
```

---

## Database Schema

The service uses SQLite for data persistence:

- **users** - User accounts (OAuth)
- **devices** - Paired devices
- **device_tokens** - Push notification tokens
- **sessions** - User sessions

---

## Security

- **OAuth 2.0** - Secure authentication
- **Rate Limiting** - Prevent abuse
- **CORS** - Configured origins only
- **WebSocket Security** - Device authentication required
- **HTTPS/WSS** - Required in production

---

## Documentation

Comprehensive documentation is available in the [`docs/`](docs/) directory:

- **[Cloud Service Guide](docs/README.md)** - Complete architecture and setup documentation
- **[Deployment Guide](docs/Deployment.md)** - Deployment instructions for various platforms
- **[ESP32 Integration](docs/ESP32_Integration.md)** - How ESP32 devices connect to cloud
- **[Pairing & Sharing](docs/Pairing_and_Sharing.md)** - Device pairing and sharing flows
- **[Database Storage](docs/Database_Storage.md)** - Database schema and storage patterns
- **[Push Notifications](docs/Push_Notifications.md)** - Push notification implementation
- **[Latency & Performance](docs/Latency_and_Performance.md)** - Performance considerations

---

## Related Repositories

- **[app](https://github.com/brewos-io/app)** - Progressive Web App (served by this service)
- **[firmware](https://github.com/brewos-io/firmware)** - ESP32 firmware (connects to this service)
- **[web](https://github.com/brewos-io/web)** - Marketing website
- **[homeassistant](https://github.com/brewos-io/homeassistant)** - Home Assistant integration

---

## License

This project is licensed under the **Apache License 2.0 with Commons Clause** - see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  <sub>Built with ☕ by espresso enthusiasts, for espresso enthusiasts</sub>
</p>

