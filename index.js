import Fastify from 'fastify';
import TorrServerClient from './torrclient.js';
import dotenv from 'dotenv';

dotenv.config();

const TORRSERVER_URL = process.env.TORRSERVER_URL || 'http://192.168.1.10:5665';
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const fastify = Fastify({ logger: true });

const torrServerClient = new TorrServerClient(TORRSERVER_URL, {
  timeout: 30000
});

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

fastify.get('/', async (request, reply) => {
  return {
    success: true,
    message: "Application is running"
  };
});

fastify.get('/ping', async (request, reply) => {
  return {
    success: true,
    message: "Ping is working!"
  };
});

fastify.get('/hello', async (request, reply) => {
  return {
    success: true,
    message: "Hello from TorrTV"
  };
});

fastify.get('/echo', async (request, reply) => {
  return {
    success: true,
    message: "Hello!"
  };
});

fastify.get('/torrents/:hash?', async (request, reply) => {
  try {
    const { hash } = request.params;

    if (hash) {
      const torrent = await torrServerClient.getTorrent(hash);
      return {
        success: true,
        torrent: torrent
      };
    } else {
      const torrents = await torrServerClient.listTorrents();
      return {
        success: true,
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
      hint: error.code === 'ECONNREFUSED'
        ? `Cannot connect to TorrServer at ${TORRSERVER_URL}. Is TorrServer running?`
        : undefined
    };
  }
});

fastify.get('/playlist/all', async (request, reply) => {
  try {
    const torrents = await torrServerClient.listTorrents();

    let m3uContent = '#EXTM3U\n';

    for (const torrent of torrents) {
      const files = parseFiles(torrent);

      if (files.length === 0) {
        continue;
      }

      const torrentTitle = torrent.title || torrent.name || 'Unknown';

      for (const file of files) {
        const fileName = file.path.split('/').pop();
        const streamUrl = torrServerClient.getStreamURL(torrent.hash, fileName, file.id);

        m3uContent += `#EXTINF:-1`;

        if (torrent.poster) {
          m3uContent += ` tvg-logo="${torrent.poster}"`;
        }

        if (torrent.category) {
          m3uContent += ` group-title="${getCategory(torrent.category)}"`;
        }

        m3uContent += ` tvg-name="${fileName}"`;
        m3uContent += `,${torrentTitle}: ${file.id}\n`;
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
      hint: error.code === 'ECONNREFUSED'
        ? `Cannot connect to TorrServer at ${TORRSERVER_URL}. Is TorrServer running?`
        : undefined
    };
  }
});

fastify.get('/playlist/:hash', async (request, reply) => {
  try {
    const { hash } = request.params;
    const torrent = await torrServerClient.getTorrent(hash);

    if (!torrent) {
      reply.code(404);
      return {
        error: 'Torrent not found',
        hash: hash
      };
    }

    const files = parseFiles(torrent);

    if (files.length === 0) {
      reply.code(404);
      return {
        error: 'Torrent has no files',
        hash: hash
      };
    }

    let m3uContent = '#EXTM3U\n';
    const torrentTitle = torrent.title || torrent.name || 'Unknown';

    for (const file of files) {
      const fileName = file.path.split('/').pop();
      const streamUrl = torrServerClient.getStreamURL(hash, fileName, file.id);
      
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
      message: error.message
    };
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: HOST });

    try {
      await torrServerClient.echo();
      fastify.log.info(`
=================================================
Server listening on http://${HOST}:${PORT}
TorrServer URL: ${TORRSERVER_URL}
TorrServer Status: ✓ Connected

Available endpoints:
  GET /torrents           - Get all torrents
  GET /torrents/:hash     - Get single torrent
  GET /playlist/all       - Get M3U playlist for all torrents
  GET /playlist/:hash     - Get M3U playlist for specific torrent
=================================================
      `);
    } catch (torrError) {
      fastify.log.warn(`
=================================================
Server listening on http://${HOST}:${PORT}
TorrServer URL: ${TORRSERVER_URL}
TorrServer Status: ✗ NOT CONNECTED

WARNING: Cannot connect to TorrServer!
Please verify:
  1. TorrServer is running
  2. TorrServer address is correct: ${TORRSERVER_URL}
  3. No firewall blocking the connection

Server will continue running but API calls will fail.
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