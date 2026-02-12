#!/bin/bash
# Setup SSH keys for GitHub Actions deployment
# Run this script to generate and configure SSH keys for CI/CD

set -e

echo "🔐 GitHub Actions SSH Key Setup"
echo "================================"
echo ""

# Check if key already exists
KEY_PATH="$HOME/.ssh/github-actions-matrx-ship"
if [ -f "$KEY_PATH" ]; then
    echo "⚠️  SSH key already exists at $KEY_PATH"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

# Generate SSH key
echo "📝 Generating SSH key pair..."
ssh-keygen -t ed25519 -C "github-actions-matrx-ship" -f "$KEY_PATH" -N ""
echo "✅ SSH key generated"
echo ""

# Display public key
echo "📋 Public Key (add this to your server's ~/.ssh/authorized_keys):"
echo "=================================================================="
cat "${KEY_PATH}.pub"
echo "=================================================================="
echo ""

# Display private key
echo "🔑 Private Key (add this to GitHub Secrets as DEPLOY_SSH_KEY):"
echo "=================================================================="
cat "$KEY_PATH"
echo "=================================================================="
echo ""

# Instructions
echo "📚 Next Steps:"
echo ""
echo "1. Add the public key to your server:"
echo "   ssh-copy-id -i ${KEY_PATH}.pub root@srv504398.hstgr.cloud"
echo ""
echo "2. Or manually add it to the server:"
echo "   ssh root@srv504398.hstgr.cloud"
echo "   echo '$(cat ${KEY_PATH}.pub)' >> ~/.ssh/authorized_keys"
echo ""
echo "3. Add secrets to GitHub:"
echo "   - Go to: https://github.com/armanisadeghi/matrx-ship/settings/secrets/actions"
echo "   - Add DEPLOY_SSH_KEY (paste the private key above)"
echo "   - Add DEPLOY_HOST: srv504398.hstgr.cloud"
echo "   - Add DEPLOY_USER: root"
echo "   - Add DEPLOY_PORT: 22 (optional)"
echo ""
echo "4. Test the connection:"
echo "   ssh -i ${KEY_PATH} root@srv504398.hstgr.cloud"
echo ""
echo "✅ Setup complete!"
