# TorrTV

A simple IPTV wrapper for TorrServer that generates M3U8 playlists compatible with most IPTV players.

## Why?

TorrServer's native playlist endpoint is not compatible with most IPTV players. TorrTV bridges this gap by providing standard M3U8 playlists.

## Quick Start

### Docker Compose

```yaml
name: 'torrtv'
version: '3'
services:
  app:
    image: jarvisnexus/torrtv:latest
    container_name: torrtv
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - TORRSERVER_URL=http://192.168.1.10:5665
    restart: always
```

Run with:
```bash
docker-compose up -d
```

## Environment Variables

- `PORT` - Server port (default: 3000)
- `TORRSERVER_URL` - TorrServer URL (default: http://192.168.1.10:5665)
- `HOST` - Server host (default: 0.0.0.0)

## API Endpoints

- `GET /torrents` - List all torrents
- `GET /torrents/:hash` - Get single torrent
- `GET /playlist/all` - M3U playlist for all torrents
- `GET /playlist/:hash` - M3U playlist for specific torrent

## Usage

Add the playlist URL to your IPTV player:
```
http://192.168.1.10:3000/playlist/all
```

Or use a specific torrent:
```
http://192.168.1.10:3000/playlist/{hash}
```