# Server Manager

Express-based MCP server for managing Docker deployments, instances, builds, and server operations.

## Quick Start

### Local Development

1. **Set up authentication** - Add a token to `.env.local`:
   ```bash
   # Generate a new token
   npm run generate-token
   
   # Add it to .env.local
   echo "MANAGER_TOKENS=<your_token>" > .env.local
   ```

2. **Start the server**:
   ```bash
   npm start
   # or with auto-reload
   npm run dev
   ```

3. **Test the API**:
   ```bash
   # Show your current token
   npm run show-token
   
   # Test the API
   curl -H "Authorization: Bearer <your_token>" http://localhost:3000/api/system
   ```

### Authentication

The server manager uses Bearer token authentication. Tokens can be configured in two ways:

#### Option 1: Environment Variables (Recommended)

Add tokens to your `.env.local` (dev) or `.env` (production):

```bash
# Single token
MANAGER_TOKENS=abc123...

# Multiple tokens (comma-separated)
MANAGER_TOKENS=token1,token2,token3
```

**Generate a token:**
```bash
npm run generate-token
# or
openssl rand -hex 32
```

#### Option 2: Legacy Single Token

For backward compatibility, you can still use the single token approach:

```bash
MANAGER_BEARER_TOKEN=your_token_here
```

This will auto-import into `tokens.json` on first boot.

#### Option 3: Managed Tokens (tokens.json)

For more control with labels, roles, and audit trails, tokens can be managed via the API:

```bash
# Create a new token
curl -X POST -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"label":"My Token","role":"admin"}' \
  http://localhost:3000/api/tokens
```

### Available Scripts

- `npm start` - Start server
- `npm run dev` - Start with auto-reload (Node.js --watch)
- `npm run generate-token` - Generate a new secure token
- `npm run show-token` - Show current token from environment

### API Endpoints

All endpoints require Bearer token authentication (except `/health`):

```bash
Authorization: Bearer <your_token>
```

#### System & Health
- `GET /health` - Health check (no auth required)
- `GET /api/system` - System information (CPU, memory, disk, Docker)

#### Instances
- `GET /api/instances` - List all instances
- `GET /api/instances/:name` - Get instance details
- `POST /api/instances` - Create new instance
- `DELETE /api/instances/:name` - Remove instance
- `POST /api/instances/:name/restart` - Restart instance
- `POST /api/instances/:name/stop` - Stop instance
- `POST /api/instances/:name/start` - Start instance
- `POST /api/instances/:name/backup` - Backup database
- `PUT /api/instances/:name/env` - Update environment variables
- `GET /api/instances/:name/logs` - Get logs
- `GET /api/instances/:name/logs/stream` - Stream logs (SSE)

#### Build & Deploy
- `GET /api/build-info` - Build information and pending changes
- `GET /api/build-history` - Build history
- `POST /api/rebuild` - Rebuild image and restart instances
- `POST /api/rebuild/stream` - Rebuild with streaming logs (SSE)
- `POST /api/rollback` - Rollback to previous build
- `POST /api/build-cleanup` - Clean up old image tags
- `POST /api/self-rebuild` - Rebuild the manager itself
- `POST /api/self-rebuild/stream` - Self-rebuild with streaming logs (SSE)

#### Sandboxes
- `GET /api/sandboxes` - List sandbox containers
- `GET /api/sandboxes/:name` - Get sandbox details
- `POST /api/sandboxes/:name/restart` - Restart sandbox
- `POST /api/sandboxes/:name/stop` - Stop sandbox
- `POST /api/sandboxes/:name/start` - Start sandbox
- `POST /api/sandboxes/:name/exec` - Execute command in sandbox

#### Database
- `GET /api/instances/:name/db/status` - Database status
- `GET /api/instances/:name/db/tables` - List tables with sizes
- `POST /api/instances/:name/db/query` - Execute read-only query
- `POST /api/instances/:name/db/restore` - Restore from backup
- `GET /api/db-health` - Health audit for all databases

#### S3 Backups
- `GET /api/s3/status` - Check S3 configuration
- `POST /api/s3/upload-image` - Upload Docker image to S3
- `POST /api/s3/upload-backup` - Upload database backup to S3
- `GET /api/s3/list` - List S3 backup files

#### Token Management (Admin only)
- `GET /api/tokens` - List managed tokens
- `POST /api/tokens` - Create new managed token
- `DELETE /api/tokens/:id` - Delete managed token

#### MCP Protocol
- `POST /mcp` - MCP protocol endpoint for tool execution

### Environment Variables

See [.env.example](./.env.example) for all available configuration options.

**Required:**
- `MANAGER_TOKENS` - Comma-separated list of valid API tokens

**Optional:**
- `PORT` - Server port (default: 3000)
- `SUPABASE_URL` - Supabase URL for persistence
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `AWS_ACCESS_KEY_ID` - AWS access key for S3 backups
- `AWS_SECRET_ACCESS_KEY` - AWS secret key
- `AWS_DEFAULT_REGION` - AWS region (default: us-east-1)
- `S3_BACKUP_BUCKET` - S3 bucket for backups

### Token Priority

The system checks tokens in this order:
1. **Environment variables** (`MANAGER_TOKENS`) - checked first
2. **Legacy single token** (`MANAGER_BEARER_TOKEN`) - auto-imported to tokens.json
3. **Managed tokens** (tokens.json) - for audit trails and roles

### Security Notes

- Never commit `.env.local` or `tokens.json` to version control
- Use different tokens for different environments
- Rotate tokens regularly
- Keep tokens secure - they provide full access to the server manager
- Environment tokens are convenient but less auditable than managed tokens
- Managed tokens support roles: `admin`, `deployer`, `viewer`

### Production Deployment

The server manager runs as a Docker container with access to:
- Host `/srv` directory (mounted as `/host-srv`)
- Host `/data` directory (mounted as `/host-data`)
- Docker socket for container management

See the main project documentation for complete deployment instructions.

### MCP Integration

This server implements the Model Context Protocol (MCP) and can be used as an MCP server by AI assistants. The MCP endpoint provides tools for:

- Shell execution
- Docker management
- File operations
- System monitoring
- Instance deployment
- Build management
- Database operations
- And more...

Connect to the MCP endpoint at: `http://localhost:3000/mcp`
