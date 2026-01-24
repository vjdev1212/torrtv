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

function getCategory(category) {
  switch (category) {
    case "all":
      return "All"
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

function isValidCategory(category) {
  const validCategories = ['movie', 'tv', 'music', 'other'];
  return validCategories.includes(category.toLowerCase());
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
      category: "Use /:category path param to filter by category (movie|tv|music|other)",
      example: `/torrents/movie?url=http://192.168.1.10:5665`
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

// Get all torrents
fastify.get('/torrents', async (request, reply) => {
  try {
    const torrents = await request.torrserverClient.listTorrents();

    return {
      success: true,
      torrserverUrl: request.torrserverUrl,
      category: 'all',
      count: torrents.length,
      torrents: torrents
    };
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

// Get torrents by category
fastify.get('/torrents/:category', async (request, reply) => {
  try {
    const { category } = request.params;

    // Validate category
    if (!isValidCategory(category)) {
      reply.code(400);
      return {
        error: 'Invalid category',
        message: `Category '${category}' is not valid. Allowed categories: movie, tv, music, other`,
        torrserverUrl: request.torrserverUrl
      };
    }

    const torrents = await request.torrserverClient.listTorrents(category);

    return {
      success: true,
      torrserverUrl: request.torrserverUrl,
      category: category,
      count: torrents.length,
      torrents: torrents
    };
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

// Get playlist for all torrents
fastify.get('/playlist/all', async (request, reply) => {
  try {
    const torrents = await request.torrserverClient.listTorrents();

    let m3uContent = '#EXTM3U\n';

    for (const torrent of torrents) {
      const torrentTitle = torrent.title || torrent.name || 'Unknown';
      const m3uUrl = request.torrserverClient.getM3UURL(torrent.hash, torrentTitle);

      m3uContent += `#EXTINF:-1`;

      if (torrent.poster) {
        m3uContent += ` tvg-logo="${torrent.poster}"`;
      }

      if (torrent.category) {
        m3uContent += ` group-title="${getCategory(torrent.category)}"`;
      }

      m3uContent += ` tvg-name="${torrentTitle}"`;
      m3uContent += `,${torrentTitle}\n`;
      m3uContent += `${m3uUrl}\n`;
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

// Get playlist for torrents by category
fastify.get('/playlist/:category', async (request, reply) => {
  try {
    const { category } = request.params;

    // Validate category
    if (!isValidCategory(category)) {
      reply.code(400);
      return {
        error: 'Invalid category',
        message: `Category '${category}' is not valid. Allowed categories: movie, tv, music, other`,
        torrserverUrl: request.torrserverUrl
      };
    }

    const torrents = await request.torrserverClient.listTorrents(category);

    let m3uContent = '#EXTM3U\n';

    for (const torrent of torrents) {
      const torrentTitle = torrent.title || torrent.name || 'Unknown';
      const m3uUrl = request.torrserverClient.getM3UURL(torrent.hash, torrentTitle);

      m3uContent += `#EXTINF:-1`;

      if (torrent.poster) {
        m3uContent += ` tvg-logo="${torrent.poster}"`;
      }

      if (torrent.category) {
        m3uContent += ` group-title="${getCategory(torrent.category)}"`;
      }

      m3uContent += ` tvg-name="${torrentTitle}"`;
      m3uContent += `,${torrentTitle}\n`;
      m3uContent += `${m3uUrl}\n`;
    }

    const filename = `TorrServer_${getCategory(category)}.m3u`;

    reply
      .type('audio/x-mpegurl; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
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
  GET /torrents
      - Get all torrents
  GET /torrents/:category
      - Get torrents filtered by category (movie|tv|music|other)
  GET /playlist/all
      - Get M3U playlist for all torrents
  GET /playlist/:category
      - Get M3U playlist filtered by category

Usage: 
  - Add ?url=<torrserver-url> to specify TorrServer URL
  - Use /:category path parameter to filter (movie|tv|music|other)
  - Or use X-TorrServer-URL header
  - If not provided, uses default: ${DEFAULT_TORRSERVER_URL}

Examples:
  /torrents
  /torrents/movie
  /playlist/all
  /playlist/tv
  /torrents?url=http://192.168.1.10:5665

Note: Playlists now use TorrServer's m3u format which generates
      sub-playlists on-the-fly for torrents with multiple files.
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