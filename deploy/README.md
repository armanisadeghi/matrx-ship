# Deploy Manager

Web interface for managing Docker deployments, builds, and server operations.

## Quick Start

### Local Development

1. **Set up authentication** - Add a token to `.env.local`:
   ```bash
   # Generate a new token
   pnpm run generate-token
   
   # Add it to .env.local
   echo "DEPLOY_TOKENS=<your_token>" > .env.local
   ```

2. **Start the dev server**:
   ```bash
   pnpm run dev
   ```

3. **Test the API**:
   ```bash
   # Show your current token
   pnpm run show-token
   
   # Test the API
   curl -H "Authorization: Bearer <your_token>" http://localhost:3000/api/system
   ```

### Authentication

The deploy manager uses Bearer token authentication. Tokens can be configured in two ways:

#### Option 1: Environment Variables (Recommended)

Add tokens to your `.env.local` (dev) or `.env` (production):

```bash
# Single token
DEPLOY_TOKENS=abc123...

# Multiple tokens (comma-separated)
DEPLOY_TOKENS=token1,token2,token3
```

**Generate a token:**
```bash
pnpm run generate-token
# or
openssl rand -hex 32
```

#### Option 2: Managed Tokens (tokens.json)

For more control with labels, roles, and audit trails:

```bash
node scripts/generate-token.js "My Token" "admin"
```

See [scripts/README.md](./scripts/README.md) for more details.

### Available Scripts

- `pnpm run dev` - Start development server
- `pnpm run build` - Build for production
- `pnpm run start` - Start production server
- `pnpm run generate-token` - Generate a new secure token
- `pnpm run show-token` - Show current token from environment

### API Endpoints

All endpoints require Bearer token authentication:

```bash
Authorization: Bearer <your_token>
```

**Available endpoints:**
- `GET /api/health` - Health check (no auth required)
- `GET /api/system` - System information
- `GET /api/build/info` - Build information
- `GET /api/build/history` - Build history
- `POST /api/build/rebuild` - Trigger rebuild
- `POST /api/build/rollback` - Rollback to previous build
- `GET /api/instances` - List instances
- More endpoints available - see source code

### Environment Variables

See [.env.example](./.env.example) for all available configuration options.

**Required:**
- `DEPLOY_TOKENS` - Comma-separated list of valid API tokens

**Optional:**
- `AWS_ACCESS_KEY_ID` - AWS access key for S3 backups
- `AWS_SECRET_ACCESS_KEY` - AWS secret key
- `AWS_DEFAULT_REGION` - AWS region (default: us-east-1)
- `S3_BACKUP_BUCKET` - S3 bucket for backups
- `HOST_SRV_PATH` - Path to host /srv directory (default: /host-srv)

### Project Structure

```
deploy/
├── src/
│   ├── app/              # Next.js App Router pages
│   │   ├── api/          # API routes
│   │   ├── manager/      # Deploy manager UI
│   │   └── page.tsx      # Home page
│   ├── components/       # React components
│   │   └── deploy/       # Deploy-specific components
│   └── lib/              # Utilities and helpers
│       ├── docker.ts     # Docker operations
│       ├── supabase.ts   # Supabase integration
│       └── utils.ts      # General utilities
├── scripts/              # Utility scripts
│   ├── generate-token.js # Token generation
│   └── README.md         # Scripts documentation
├── .env.example          # Environment template
├── .env.local            # Local environment (gitignored)
└── tokens.local.json     # Local tokens (gitignored)
```

### Security Notes

- Never commit `.env.local` or `tokens.local.json` to version control
- Use different tokens for different environments
- Rotate tokens regularly
- Keep tokens secure - they provide full access to the deploy manager
- Environment tokens are convenient but less auditable than managed tokens

### Production Deployment

1. Build the Docker image:
   ```bash
   docker build -t matrx-ship-deploy:latest .
   ```

2. Set environment variables in your deployment:
   ```bash
   DEPLOY_TOKENS=your_production_token
   AWS_ACCESS_KEY_ID=...
   AWS_SECRET_ACCESS_KEY=...
   ```

3. Run the container with required mounts:
   ```bash
   docker run -d \
     -p 3000:3000 \
     -v /srv:/host-srv \
     -v /var/run/docker.sock:/var/run/docker.sock \
     --env-file .env \
     matrx-ship-deploy:latest
   ```

See the main project documentation for complete deployment instructions.
