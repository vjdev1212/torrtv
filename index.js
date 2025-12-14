import Fastify from 'fastify';
import TorrServerClient from './torrclient.js';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_TORRSERVER_URL = process.env.TORRSERVER_URL || 'http://192.168.1.10:5665';
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const fastify = Fastify({ logger: true });

// Cache TorrServer clients by URL
const clientCache = new Map();

function getTorrServerClient(url) {
  if (!clientCache.has(url)) {
    clientCache.set(url, new TorrServerClient(url, {
      timeout: 30000
    }));
  }
  return clientCache.get(url);
}

function parseFiles(torrent) {
  try {
    if (torrent.file_stats && Array.isArray(torrent.file_stats)) {
      return torrent.file_stats;
    }

    if (torrent.data) {
      const parsedData = JSON.parse(torrent.data);
      if (parsedData.TorrServer && parsedData.TorrServer.Files) {
        return parsedData.TorrServer.Files;
      }
    }

    return [];
  } catch (error) {
    fastify.log.error(`Error parsing files for torrent ${torrent.hash}:`, error);
    return [];
  }
}

function getCategory(category) {
  switch (category) {
    case "movie":
      return "Movies";
    case "tv":
      return "TV Shows";
    case "music":
      return "Music";
    case "other":
      return "Others";
    default:
      return "Others";
  }
}

function isVideoFile(fileName) {
  const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp', '.ts'];
  const ext = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
  return videoExtensions.includes(ext);
}

// Middleware to extract TorrServer URL from request
fastify.addHook('preHandler', (request, reply, done) => {
  // Get URL from query param, header, or use default
  const url = request.query.url ||
    request.headers['x-torrserver-url'] ||
    DEFAULT_TORRSERVER_URL;

  request.torrserverUrl = url;
  request.torrserverClient = getTorrServerClient(url);
  done();
});

fastify.get('/', async (request, reply) => {
  return {
    success: true,
    message: "TorrTV API is running",
    defaultUrl: DEFAULT_TORRSERVER_URL,
    usage: {
      query: "Add ?url=<torrserver-url> to your requests",
      header: "Or use X-TorrServer-URL header",
      example: `/torrents?url=http://192.168.1.10:5665`
    }
  };
});

fastify.get('/ping', async (request, reply) => {
  return {
    success: true,
    message: "Ping is working!",
    torrserverUrl: request.torrserverUrl
  };
});

fastify.get('/hello', async (request, reply) => {
  return {
    success: true,
    message: "Hello from TorrTV",
    torrserverUrl: request.torrserverUrl
  };
});

fastify.get('/echo', async (request, reply) => {
  try {
    await request.torrserverClient.echo();
    return {
      success: true,
      message: "Echo successful!",
      torrserverUrl: request.torrserverUrl
    };
  } catch (error) {
    reply.code(500);
    return {
      success: false,
      error: 'Echo failed',
      message: error.message,
      torrserverUrl: request.torrserverUrl,
      hint: error.code === 'ECONNREFUSED'
        ? `Cannot connect to TorrServer at ${request.torrserverUrl}. Is TorrServer running?`
        : undefined
    };
  }
});

fastify.get('/torrents/:hash?', async (request, reply) => {
  try {
    const { hash } = request.params;

    if (hash) {
      const torrent = await request.torrserverClient.getTorrent(hash);
      return {
        success: true,
        torrserverUrl: request.torrserverUrl,
        torrent: torrent
      };
    } else {
      const torrents = await request.torrserverClient.listTorrents();
      return {
        success: true,
        torrserverUrl: request.torrserverUrl,
        count: torrents.length,
        torrents: torrents
      };
    }
  } catch (error) {
    fastify.log.error(error);
    reply.code(500);
    return {
      error: 'Failed to fetch torrents',
      message: error.message,
      torrserverUrl: request.torrserverUrl,
      hint: error.code === 'ECONNREFUSED'
        ? `Cannot connect to TorrServer at ${request.torrserverUrl}. Is TorrServer running?`
        : undefined
    };
  }
});

fastify.get('/playlist/all', async (request, reply) => {
  try {
    const torrents = await request.torrserverClient.listTorrents();

    let m3uContent = '#EXTM3U\n';

    for (const torrent of torrents) {
      const files = parseFiles(torrent);

      if (files.length === 0) {
        continue;
      }

      const torrentTitle = torrent.title || torrent.name || 'Unknown';

      // Filter to only include video files
      const videoFiles = files.filter(file => {
        const fileName = file.path.split('/').pop();
        return isVideoFile(fileName);
      });

      for (const file of videoFiles) {
        const fileName = file.path.split('/').pop();
        const streamUrl = request.torrserverClient.getStreamURL(torrent.hash, fileName, file.id);

        m3uContent += `#EXTINF:-1`;

        if (torrent.poster) {
          m3uContent += ` tvg-logo="${torrent.poster}"`;
        }

        if (torrent.category) {
          m3uContent += ` group-title="${getCategory(torrent.category)}"`;
        }

        m3uContent += ` tvg-name="${fileName}"`;
        m3uContent += `,${fileName}\n`;
        m3uContent += `${streamUrl}\n`;
      }
    }

    reply
      .type('audio/x-mpegurl; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="TorrServer.m3u"')
      .send(m3uContent);

  } catch (error) {
    fastify.log.error(error);
    reply.code(500);
    return {
      error: 'Failed to generate playlist',
      message: error.message,
      torrserverUrl: request.torrserverUrl,
      hint: error.code === 'ECONNREFUSED'
        ? `Cannot connect to TorrServer at ${request.torrserverUrl}. Is TorrServer running?`
        : undefined
    };
  }
});

fastify.get('/playlist/:hash', async (request, reply) => {
  try {
    const { hash } = request.params;
    const torrent = await request.torrserverClient.getTorrent(hash);

    if (!torrent) {
      reply.code(404);
      return {
        error: 'Torrent not found',
        hash: hash,
        torrserverUrl: request.torrserverUrl
      };
    }

    const files = parseFiles(torrent);

    if (files.length === 0) {
      reply.code(404);
      return {
        error: 'Torrent has no files',
        hash: hash,
        torrserverUrl: request.torrserverUrl
      };
    }

    let m3uContent = '#EXTM3U\n';
    const torrentTitle = torrent.title || torrent.name || 'Unknown';

    // Filter to only include video files
    const videoFiles = files.filter(file => {
      const fileName = file.path.split('/').pop();
      return isVideoFile(fileName);
    });

    if (videoFiles.length === 0) {
      reply.code(404);
      return {
        error: 'Torrent has no video files',
        hash: hash,
        torrserverUrl: request.torrserverUrl
      };
    }

    for (const file of videoFiles) {
      const fileName = file.path.split('/').pop();
      const streamUrl = request.torrserverClient.getStreamURL(hash, fileName, file.id);

      m3uContent += `#EXTINF:-1`;

      if (torrent.poster) {
        m3uContent += ` tvg-logo="${torrent.poster}"`;
      }

      m3uContent += ` tvg-name="${fileName}"`;
      m3uContent += `,${torrentTitle}\n`;
      m3uContent += `${streamUrl}\n`;
    }

    const safeFileName = torrentTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();

    reply
      .type('audio/x-mpegurl; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${safeFileName}.m3u"`)
      .send(m3uContent);

  } catch (error) {
    fastify.log.error(error);
    reply.code(500);
    return {
      error: 'Failed to generate playlist',
      message: error.message,
      torrserverUrl: request.torrserverUrl
    };
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: HOST });

    try {
      const defaultClient = getTorrServerClient(DEFAULT_TORRSERVER_URL);
      await defaultClient.echo();
      fastify.log.info(`
=================================================
Server listening on http://${HOST}:${PORT}
Default TorrServer URL: ${DEFAULT_TORRSERVER_URL}
TorrServer Status: ✓ Connected

Available endpoints:
  GET /torrents?url=<url>      - Get all torrents
  GET /torrents/:hash?url=<url> - Get single torrent
  GET /playlist/all?url=<url>  - Get M3U playlist for all torrents
  GET /playlist/:hash?url=<url> - Get M3U playlist for specific torrent

Usage: Add ?url=<torrserver-url> to any request
       Or use X-TorrServer-URL header
       If not provided, uses default: ${DEFAULT_TORRSERVER_URL}
=================================================
      `);
    } catch (torrError) {
      fastify.log.warn(`
=================================================
Server listening on http://${HOST}:${PORT}
Default TorrServer URL: ${DEFAULT_TORRSERVER_URL}
TorrServer Status: ✗ NOT CONNECTED

WARNING: Cannot connect to default TorrServer!
Please verify:
  1. TorrServer is running
  2. TorrServer address is correct: ${DEFAULT_TORRSERVER_URL}
  3. No firewall blocking the connection

Server will continue running. You can specify different TorrServer URLs
using ?url=<torrserver-url> query parameter.
=================================================
      `);
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  fastify.log.info('Shutting down gracefully...');
  await fastify.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();

export default fastify;