# HLS Proxy Worker

A Cloudflare Worker for proxying HLS streams with datacrate-style URL encoding. This worker provides a secure, scalable streaming proxy that supports M3U8 playlists and TS segments.

## Features

- **Datacrate URL Decoding**: Supports `/file2/[sessionPath]/[qualityB64]/[filenameB64].m3u8` format
- **Session Management**: Uses Cloudflare KV for session storage and URL mapping
- **HLS Proxying**: Proxies M3U8 playlists and TS segments with proper headers
- **CORS Support**: Configurable CORS headers for cross-origin requests
- **Auto Session Storage**: Automatically stores session data when not found
- **Error Handling**: Comprehensive error responses with proper HTTP status codes

## URL Format

The worker expects URLs in the following format:
```
https://vidninja.pro/cdn-hls1/file2/[sessionPath]/[qualityB64]/[filenameB64].m3u8
```

Where:
- `sessionPath`: Identifier for the session
- `qualityB64`: Base64-encoded quality information
- `filenameB64`: Base64-encoded filename

## Deployment

### Prerequisites

1. Install Wrangler CLI:
```bash
npm install -g wrangler
```

2. Authenticate with Cloudflare:
```bash
wrangler auth login
```

### Setup KV Namespace

1. Create KV namespace:
```bash
wrangler kv:namespace create "SESSIONS"
wrangler kv:namespace create "SESSIONS" --preview
```

2. Update `wrangler.toml` with the namespace IDs returned from the above commands.

### Deploy

1. Install dependencies:
```bash
npm install
```

2. Deploy to Cloudflare:
```bash
npm run deploy
```

### Configure Custom Domain

1. In Cloudflare dashboard, go to Workers & Pages
2. Select your worker
3. Add custom domain: `vidninja.pro`
4. Add route: `vidninja.pro/cdn-hls1/*`

## Configuration

### Environment Variables

You can configure the following in `wrangler.toml`:

- `MAX_SESSION_AGE`: Session expiration time in milliseconds (default: 1 hour)
- `CORS_ORIGINS`: Allowed CORS origins (default: "*")

### KV Storage

The worker uses Cloudflare KV to store session mappings. Sessions are automatically created when a valid encoded URL is accessed but no session exists.

## Testing

### Local Development

```bash
npm run dev
```

This starts a local development server with hot reloading.

### Production Testing

Test the deployed worker with a sample URL:
```
https://vidninja.pro/cdn-hls1/file2/test-session/cXVhbGl0eQ==/cGxheWxpc3QubTN1OA==.m3u8
```

## Integration

The worker is designed to work with the VidSrc providers that use the MasterUrlEncoder. Example usage:

```javascript
// In your provider code
const encoder = new MasterUrlEncoder();
const sessionPath = await encoder.createSession({
  originalUrl: 'https://example.com/playlist.m3u8',
  quality: 'auto',
  filename: 'playlist.m3u8'
});

const proxyUrl = `https://vidninja.pro/cdn-hls1/file2/${sessionPath}/cXVhbGl0eQ==/cGxheWxpc3QubTN1OA==.m3u8`;
```

## Security

- Sessions expire automatically based on `MAX_SESSION_AGE`
- CORS can be restricted to specific origins
- No sensitive data is logged
- All external requests include proper headers

## Monitoring

Use Wrangler to monitor logs:
```bash
npm run tail
```

## Troubleshooting

### Common Issues

1. **KV Namespace not found**: Ensure KV namespace IDs are correctly set in `wrangler.toml`
2. **CORS errors**: Check CORS configuration in worker code
3. **Session not found**: Verify URL encoding format and session storage
4. **Stream not playing**: Check if original stream URL is accessible and valid

### Debug Mode

Enable debug logging by adding `console.log` statements in the worker code and use `wrangler tail` to view logs.
"# vidninja.pro-proxy" 
