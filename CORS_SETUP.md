# CORS Configuration Guide

## What is CORS?

Cross-Origin Resource Sharing (CORS) is a security feature that controls which domains can access your server. Without proper CORS configuration, any malicious website could connect to your game server.

## Security Improvements

### Before (INSECURE ❌)

```javascript
cors: {
  origin: "*",  // Allows ANY website to connect!
  methods: ["GET", "POST"],
}
```

### After (SECURE ✅)

```javascript
cors: {
  origin: (origin, callback) => {
    // Only allows explicitly whitelisted domains
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'), false);
    }
  },
  methods: ["GET", "POST"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"],
}
```

## Configuration

### Environment Variables

Add the following to your `.env` file:

```env
# Development
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Production (example)
NODE_ENV=production
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

### How It Works

1. **Development Mode** (`NODE_ENV !== 'production'`):

   - Automatically allows `localhost:3000` and `127.0.0.1:3000`
   - Plus any origins specified in `ALLOWED_ORIGINS`

2. **Production Mode** (`NODE_ENV === 'production'`):

   - **ONLY** allows origins explicitly listed in `ALLOWED_ORIGINS`
   - Blocks all other origins with a CORS error

3. **No Origin** (same-origin requests, mobile apps, Postman):
   - Allowed by default (request has no `Origin` header)

## Setup Instructions

### Local Development

1. Update your `.env` file:

```env
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

2. Restart your server:

```bash
npm run dev
```

3. Check the console output:

```
🔒 CORS Configuration:
   Environment: development
   Allowed origins: http://localhost:3000, http://127.0.0.1:3000
```

### Production Deployment

1. Set environment variables on your hosting platform (Render, Heroku, etc.):

```env
NODE_ENV=production
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

2. **Important**: Replace `yourdomain.com` with your actual domain(s)

3. Multiple domains can be added separated by commas (no spaces after commas)

### Adding New Allowed Origins

To allow additional domains, add them to the `ALLOWED_ORIGINS` variable:

```env
ALLOWED_ORIGINS=https://domain1.com,https://domain2.com,https://app.domain3.com
```

## Testing CORS

### Successful Connection

```
✅ WebSocket connected from allowed origin
```

### Blocked Connection

```
⚠️ CORS: Origin not allowed: https://malicious-site.com
Error: CORS policy: Origin https://malicious-site.com is not allowed
```

## Security Benefits

1. **Prevents Unauthorized Access**: Only your frontend can connect to your game server
2. **Stops Cross-Site Attacks**: Malicious websites can't impersonate your frontend
3. **Protects User Data**: Players can't be tricked into connecting to fake clients
4. **Audit Trail**: All blocked origins are logged for security monitoring

## Troubleshooting

### "CORS policy: Origin X is not allowed"

**Solution**: Add the origin to your `ALLOWED_ORIGINS` list:

```env
ALLOWED_ORIGINS=http://localhost:3000,X
```

### "No allowed origins configured"

**Solution**: Set the `ALLOWED_ORIGINS` environment variable in your `.env` file

### Still seeing `origin: "*"`

**Solution**:

1. Make sure your `.env` file is in the root directory
2. Restart your server after changing `.env`
3. Check that `dotenv` is properly loaded at the top of `server/index.js`

## Next Security Steps

After implementing CORS, consider:

1. ✅ **CORS Configuration** (DONE)
2. ⏭️ Input Validation
3. ⏭️ Rate Limiting
4. ⏭️ Authentication System
5. ⏭️ Request Sanitization

## Additional Resources

- [MDN: CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [Socket.IO CORS Docs](https://socket.io/docs/v4/handling-cors/)
