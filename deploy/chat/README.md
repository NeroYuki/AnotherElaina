# Chat support services

This Compose stack runs Qdrant and SearXNG only. MongoDB and the local inference orchestrator remain separately configured. Ports bind to loopback by default. For a bot on another trusted LAN machine, bind the concrete service-host LAN address and restrict inbound traffic to the bot host; do not publish these services to the internet or a VPN interface.

Pinned images:

- Qdrant `v1.19.0`, multi-architecture digest `sha256:057ee3a8da769fe7310dd3537b4dc7583bf87a95ce8ac43c0af5a46bc580d1fc`
- SearXNG `2026.9.8-3fdc6d753`, multi-architecture digest `sha256:3547509b419cd6a67333d6d68bd1ffad8d46d3669d82e7a7bd538f7b45827432`

Generate a secret and start the services in PowerShell:

```powershell
$env:SEARXNG_SECRET = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:QDRANT_API_KEY = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:CHAT_SERVICE_BIND_ADDRESS = '192.168.1.2'
$env:SEARXNG_BASE_URL = 'http://192.168.1.2:8088/'
docker compose -f deploy/chat/compose.yaml pull
docker compose -f deploy/chat/compose.yaml up -d
docker compose -f deploy/chat/compose.yaml ps
```

Before the LAN bind, run the source restriction once from an **Administrator PowerShell** window. The rule permits the Linux `/32` plus the Windows service address itself so local maintenance smoke remains possible:

```powershell
.\deploy\chat\configure-windows-lan.ps1 -BotHostAddress 192.168.1.9 -ServiceBindAddress 192.168.1.2
```

Run the same command with the new Linux address whenever DHCP changes it; the named rule is replaced with the new `/32` source. A DHCP reservation for the Linux host avoids that operational failure mode.

Configure the application with:

```dotenv
AI_PROXY_URL=http://192.168.1.2:11230
MONGODB_CONNECTION_STRING=mongodb://127.0.0.1:27017
QDRANT_URL=http://192.168.1.2:6333
QDRANT_API_KEY=<same value configured on the service host>
SEARXNG_URL=http://192.168.1.2:8088
CHAT_MODEL=unsloth/gemma-4-12B-it-qat-GGUF
CHAT_MODEL_QUANTIZATION=
CHAT_CONTEXT_TOKENS=16384
CHAT_EPISODE_INPUT_TOKENS=6000
CHAT_ALLOW_EXTREME_MODEL=false
```

The empty quantization value selects the fixed variant from `chat/model_profiles.js`. The alternatives are repository `unsloth/Qwen3.8-27B-GGUF` with variant `UD-Q4_K_M` and, only after setting `CHAT_ALLOW_EXTREME_MODEL=true`, repository `unsloth/Qwen3.8-Flash-Next-GGUF` with variant `UD-IQ3_XXS`. Do not put the UI's `repo:variant` display form in `CHAT_MODEL`; Unsloth's API expects these as separate fields.

SearXNG JSON output is explicitly enabled in `searxng-settings.yml`. Search quality and availability still depend on enabled upstream engines. Verify both services before enabling chat:

```powershell
Invoke-RestMethod http://192.168.1.2:6333/healthz
Invoke-RestMethod 'http://192.168.1.2:8088/search?q=Node.js&format=json'
```

On the Linux bot host, merge `.env.chat.example` into its private runtime environment and run `npm run chat:smoke:remote`. The command is strict and rejects loopback endpoints, so it verifies the same network path the bot process will use.

MongoDB runs on the Linux bot host in this deployment, so keep `MONGODB_CONNECTION_STRING=mongodb://127.0.0.1:27017`. Port 27017 does not cross the LAN, and the Windows MongoDB service remains unchanged.

The web fetcher uses native Node `fetch`, Cheerio `1.1.2`, and an Undici dispatcher for DNS pinning. Tool validation uses Ajv 8 when installed and retains a strict built-in validator for isolated tests. Declare `ajv@8` and `undici@7.29.0` as direct runtime dependencies when dependency ownership is integrated; do not rely permanently on Cheerio's transitive Undici copy. No proxy, cookies, credentials, or browser execution are used for arbitrary pages.

To stop without deleting data, run `docker compose -f deploy/chat/compose.yaml down`. Do not add `-v` unless permanent Qdrant and SearXNG cache deletion is intentional.
