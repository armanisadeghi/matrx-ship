# Deploy Manager Scripts

## Authentication

The deploy manager uses token-based authentication with two methods:

### 1. Environment Variable Tokens (Recommended)

The simplest way to manage tokens is via the `DEPLOY_TOKENS` environment variable.

**Local Development** (`.env.local`):
```bash
DEPLOY_TOKENS=your_token_here
```

**Production** (`.env` or container environment):
```bash
DEPLOY_TOKENS=token1,token2,token3
```

You can specify multiple tokens separated by commas. This is perfect for:
- Local development
- Quick access when needed
- Temporary tokens
- Team member access

**Generate a new token:**
```bash
openssl rand -hex 32
```

### 2. Managed Tokens (tokens.json)

For more control (labels, roles, audit trails), use the token generation script:

```bash
node scripts/generate-token.js "Token Label" "admin"
```

This creates entries in `tokens.local.json` (dev) or `/srv/apps/tokens.json` (production) with:
- Unique IDs
- SHA-256 hashes (tokens never stored in plain text)
- Labels for identification
- Role assignments
- Creation and last-used timestamps

### Using Tokens

**cURL:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/api/system
```

**Browser Console:**
```javascript
fetch('http://localhost:3000/api/system', {
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN'
  }
}).then(r => r.json()).then(console.log)
```

### Token Priority

The system checks tokens in this order:
1. **Environment variables** (`DEPLOY_TOKENS`) - checked first
2. **tokens.local.json** - for local development
3. **tokens.json** - for production managed tokens

### Security Notes

- Tokens are 64-character hexadecimal strings (256 bits of entropy)
- Environment tokens are checked as plain text (convenient but less auditable)
- Managed tokens use SHA-256 hashes (more secure, auditable)
- Never commit `.env.local` or tokens to version control
- Use different tokens for different environments
- Rotate tokens regularly for security
