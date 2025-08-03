/**
 * Cloudflare Worker for HLS Stream Proxy
 * Supports datacrate-style encoded URLs
 * Endpoint: vidninja.pro/cdn-hls1
 */

// In-memory session store (use KV storage for production)
const sessionStore = new Map();

// Session management
const storeSession = (sessionId, originalUrl, metadata = {}) => {
  sessionStore.set(sessionId, {
    originalUrl,
    metadata,
    timestamp: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
  });
};

const getSession = (sessionId) => {
  const session = sessionStore.get(sessionId);
  if (!session) return null;

  // Check if expired
  if (session.expiresAt && Date.now() > session.expiresAt) {
    sessionStore.delete(sessionId);
    return null;
  }

  return session;
};

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range, Accept, Origin, X-Requested-With',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  'Access-Control-Max-Age': '86400',
};

// Helper to add CORS headers
const addCorsHeaders = (response) => {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
};

// Store session endpoint
async function handleStoreSession(request) {
  if (request.method !== 'POST') {
    return addCorsHeaders(new Response('Method not allowed', { status: 405 }));
  }

  try {
    const { sessionId, originalUrl, metadata } = await request.json();

    if (!sessionId || !originalUrl) {
      return addCorsHeaders(
        new Response(
          JSON.stringify({
            error: 'sessionId and originalUrl are required',
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    }

    storeSession(sessionId, originalUrl, metadata);

    return addCorsHeaders(
      new Response(
        JSON.stringify({
          success: true,
          sessionId,
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
  } catch (error) {
    return addCorsHeaders(
      new Response(
        JSON.stringify({
          error: 'Invalid JSON payload',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
  }
}

// Proxy video segments
async function proxyVideoSegment(originalUrl, filename) {
  try {
    // Construct segment URL
    const baseUrl = originalUrl.substring(0, originalUrl.lastIndexOf('/'));
    const segmentUrl = `${baseUrl}/${filename}`;

    // Fetch the segment with proper headers
    const response = await fetch(segmentUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://vidsrc.vip/',
        Origin: 'https://vidsrc.vip',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch segment: ${response.status}`);
    }

    // Create proxied response with proper headers
    const proxyResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        'Content-Type': 'video/mp2t',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      },
    });

    return addCorsHeaders(proxyResponse);
  } catch (error) {
    return addCorsHeaders(
      new Response(
        JSON.stringify({
          error: 'Segment not available',
          filename,
          originalError: error.message,
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
  }
}

// Proxy M3U8 playlists
async function proxyM3U8Playlist(originalUrl, filename, quality, sessionPath, request) {
  try {
    // Determine target URL
    let targetUrl = originalUrl;

    if (filename === 'master.m3u8') {
      // Use the original master playlist URL
      targetUrl = originalUrl;
    } else if (filename === 'index.m3u8' || filename === 'playlist.m3u8') {
      // Construct quality-specific playlist URL
      const baseUrl = originalUrl.substring(0, originalUrl.lastIndexOf('/'));
      targetUrl = `${baseUrl}/${quality}/index.m3u8`;
    }

    // Fetch the playlist
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://vidsrc.vip/',
        Origin: 'https://vidsrc.vip',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch playlist: ${response.status} ${response.statusText}`);
    }

    const originalPlaylist = await response.text();

    // Rewrite URLs in the playlist
    let rewrittenPlaylist = originalPlaylist;

    if (filename === 'master.m3u8') {
      // Rewrite variant stream URLs in master playlist
      rewrittenPlaylist = originalPlaylist.replace(/^(?!#)(https?:\/\/[^\s]+|[^/\s][^\s]*\.m3u8)/gm, (match) => {
        // Extract quality from the URL if possible
        const qualityMatch = match.match(/\/(\d+p?|low|med|high)\//);
        const detectedQuality = qualityMatch ? qualityMatch[1] : 'unknown';
        const qualityB64 = btoa(detectedQuality).replace(/=/g, '');
        const filenameB64 = btoa('index.m3u8').replace(/=/g, '');

        return `${new URL(request.url).origin}/file2/${sessionPath}/${qualityB64}/${filenameB64}.m3u8`;
      });
    } else {
      // Rewrite segment URLs in quality-specific playlists
      rewrittenPlaylist = originalPlaylist.replace(/^(?!#)(https?:\/\/[^\s]+|[^/\s][^\s]*\.ts)/gm, (match) => {
        // Extract just the filename
        const segmentName = match.split('/').pop();
        const segmentB64 = btoa(segmentName).replace(/=/g, '');
        const qualityB64 = btoa(quality).replace(/=/g, '');

        return `${new URL(request.url).origin}/file2/${sessionPath}/${qualityB64}/${segmentB64}`;
      });
    }

    const proxyResponse = new Response(rewrittenPlaylist, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });

    return addCorsHeaders(proxyResponse);
  } catch (error) {
    return addCorsHeaders(
      new Response(
        JSON.stringify({
          error: 'Playlist not available',
          details: error.message,
          filename,
          quality,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
  }
}

// Datacrate-style proxy handler
async function handleDatacrateProxy(request, url) {
  const pathParts = url.pathname.split('/');

  if (pathParts.length < 5) {
    return addCorsHeaders(new Response('Invalid URL format', { status: 400 }));
  }

  const sessionPath = pathParts[2];
  const qualityB64 = pathParts[3];
  const filenameB64 = pathParts[4];

  try {
    // Decode URL parts
    const quality = atob(`${qualityB64}==`);
    const filename = atob(`${filenameB64.replace('.m3u8', '')}==`);

    // Get session data
    const sessionData = getSession(sessionPath);
    if (!sessionData) {
      return addCorsHeaders(
        new Response(
          JSON.stringify({
            error: 'Session not found or expired',
            sessionPath: `${sessionPath.substring(0, 20)}...`,
            note: 'Session may have expired or was never stored',
          }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    }

    // Handle video segments (.ts files)
    if (
      filename.endsWith('.ts') ||
      (!filename.includes('.m3u8') && !filename.includes('master') && !filename.includes('index'))
    ) {
      return await proxyVideoSegment(sessionData.originalUrl, filename);
    }

    // Handle M3U8 playlists
    return await proxyM3U8Playlist(sessionData.originalUrl, filename, quality, sessionPath, request);
  } catch (error) {
    return addCorsHeaders(
      new Response(
        JSON.stringify({
          error: 'Failed to decode URL',
          details: error.message,
          timestamp: new Date().toISOString(),
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
  }
}

// Legacy proxy handler (deprecated - redirects to main format)
async function handleLegacyProxy(request, url) {
  const pathParts = url.pathname.split('/').filter(Boolean);

  if (pathParts.length < 5) {
    return addCorsHeaders(new Response('Invalid legacy URL format', { status: 400 }));
  }

  // Legacy format is deprecated - return proper error
  return addCorsHeaders(
    new Response(
      JSON.stringify({
        error: 'Legacy format deprecated',
        message: 'Please use the datacrate format: /file2/[session]/[quality]/[filename].m3u8',
        format: 'file2/[sessionPath]/[qualityBase64]/[filenameBase64].m3u8',
        example: '/file2/abc123/cXVhbGl0eQ==/cGxheWxpc3QubTN1OA==.m3u8',
      }),
      {
        status: 410, // Gone
        headers: { 'Content-Type': 'application/json' },
      },
    ),
  );
}

// Health check endpoint
async function handleHealth() {
  return addCorsHeaders(
    new Response(
      JSON.stringify({
        status: 'ok',
        message: 'HLS Proxy Worker is running',
        timestamp: new Date().toISOString(),
        endpoints: {
          'store-session': 'POST /store-session - Store session data',
          datacrate: 'GET /file2/[session]/[quality]/[filename] - Proxy HLS streams',
          legacy: 'GET /stream/[provider]/[quality]/[type]/[data] - Legacy format',
          health: 'GET /health - Health check',
        },
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    ),
  );
}

// Main request handler
export default {
  async fetch(request, _env, _ctx) {
    const url = new URL(request.url);

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return addCorsHeaders(new Response(null, { status: 200 }));
    }

    try {
      // Route handling
      if (url.pathname.startsWith('/store-session')) {
        return handleStoreSession(request);
      }
      if (url.pathname.startsWith('/file2/')) {
        return handleDatacrateProxy(request, url);
      }
      if (url.pathname.startsWith('/stream/')) {
        return handleLegacyProxy(request, url);
      }
      if (url.pathname === '/health') {
        return handleHealth();
      }
      return addCorsHeaders(
        new Response('HLS Proxy Worker - Ready', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
      );
    } catch (error) {
      return addCorsHeaders(
        new Response(
          JSON.stringify({
            error: 'Internal Server Error',
            message: error.message,
            timestamp: new Date().toISOString(),
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    }
  },
};
