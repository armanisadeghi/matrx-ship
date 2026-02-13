#!/usr/bin/env node

/**
 * Generate a managed token for the deploy manager with labels and audit trail
 * 
 * Usage: node scripts/generate-token.js [label] [role]
 * 
 * Example: node scripts/generate-token.js "Production Admin" "admin"
 * 
 * For simple tokens, use: openssl rand -hex 32
 * Then add to DEPLOY_TOKENS environment variable
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Generate a secure random token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Hash the token using SHA-256
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Get command line arguments
const label = process.argv[2] || 'Managed Token';
const role = process.argv[3] || 'admin';

// Generate token
const token = generateToken();
const tokenHash = hashToken(token);
const now = new Date().toISOString();

// Create token entry
const tokenEntry = {
  id: `tok_${crypto.randomBytes(6).toString('hex')}`,
  token_hash: tokenHash,
  label: label,
  role: role,
  created_at: now,
  last_used_at: null
};

console.log('\n🔐 Managed Token Generated Successfully!\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('📋 Token (use this in your requests):');
console.log(`   ${token}\n`);
console.log('🔒 Token Hash (stored in tokens.json):');
console.log(`   ${tokenHash}\n`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('📝 Token Entry (add this to tokens.json):\n');
console.log(JSON.stringify(tokenEntry, null, 2));
console.log('\n');

// For local development, try to write to a local tokens file
const localTokensPath = path.join(__dirname, '..', 'tokens.local.json');

try {
  let tokensData = { tokens: [] };
  
  // Read existing tokens if file exists
  if (fs.existsSync(localTokensPath)) {
    const existing = fs.readFileSync(localTokensPath, 'utf-8');
    tokensData = JSON.parse(existing);
  }
  
  // Add new token
  tokensData.tokens.push(tokenEntry);
  
  // Write back to file
  fs.writeFileSync(localTokensPath, JSON.stringify(tokensData, null, 2) + '\n', 'utf-8');
  
  console.log(`✅ Token saved to: ${localTokensPath}\n`);
} catch (error) {
  console.log(`⚠️  Could not save to local file: ${error.message}\n`);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('📖 How to use:\n');
console.log('   Managed tokens (with labels and audit trail):');
console.log('   1. Add the token entry above to tokens.local.json (dev) or /srv/apps/tokens.json (prod)');
console.log('   2. Use the token in your HTTP requests:\n');
console.log('      Authorization: Bearer ' + token + '\n');
console.log('   Simple tokens (no audit trail):');
console.log('   1. Add the token to .env.local:');
console.log('      DEPLOY_TOKENS=' + token);
console.log('   2. Restart the dev server\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
