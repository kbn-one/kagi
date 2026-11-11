#!/bin/bash
set -euo pipefail

# Run only in Claude Code on the web (remote) environment.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Install Deno only if it's not already on PATH or in the default install dir.
if ! command -v deno >/dev/null 2>&1 && [ ! -x "$HOME/.deno/bin/deno" ]; then
  curl -fsSL https://deno.land/install.sh | sh
fi

# Persist env for the session so `deno` is callable and TLS works through
# the sandbox proxy (whose CA lives in the system CA bundle).
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export PATH=\"\$HOME/.deno/bin:\$PATH\""
    echo 'export DENO_CERT=/etc/ssl/certs/ca-certificates.crt'
  } >> "$CLAUDE_ENV_FILE"
fi
