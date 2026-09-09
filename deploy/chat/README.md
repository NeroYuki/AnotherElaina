# Chat support services

This Compose stack runs Qdrant and SearXNG only. MongoDB and the local inference orchestrator remain separately configured. Both ports bind to loopback and must not be exposed publicly.

Pinned images:

- Qdrant `v1.19.0`, multi-architecture digest `sha256:057ee3a8da769fe7310dd3537b4dc7583bf87a95ce8ac43c0af5a46bc580d1fc`
- SearXNG `2026.9.8-3fdc6d753`, multi-architecture digest `sha256:3547509b419cd6a67333d6d68bd1ffad8d46d3669d82e7a7bd538f7b45827432`

Generate a secret and start the services in PowerShell:

```powershell
$env:SEARXNG_SECRET = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
docker compose -f deploy/chat/compose.yaml pull
docker compose -f deploy/chat/compose.yaml up -d
docker compose -f deploy/chat/compose.yaml ps
```

Configure the application with:

```dotenv
QDRANT_URL=http://127.0.0.1:6333
SEARXNG_URL=http://127.0.0.1:8088
```

SearXNG JSON output is explicitly enabled in `searxng-settings.yml`. Search quality and availability still depend on enabled upstream engines. Verify both services before enabling chat:

```powershell
Invoke-RestMethod http://127.0.0.1:6333/healthz
Invoke-RestMethod 'http://127.0.0.1:8088/search?q=Node.js&format=json'
```

The web fetcher uses native Node `fetch`, Cheerio `1.1.2`, and an Undici dispatcher for DNS pinning. Tool validation uses Ajv 8 when installed and retains a strict built-in validator for isolated tests. Declare `ajv@8` and `undici@7.29.0` as direct runtime dependencies when dependency ownership is integrated; do not rely permanently on Cheerio's transitive Undici copy. No proxy, cookies, credentials, or browser execution are used for arbitrary pages.

To stop without deleting data, run `docker compose -f deploy/chat/compose.yaml down`. Do not add `-v` unless permanent Qdrant and SearXNG cache deletion is intentional.
