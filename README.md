# TrailDash.io

TrailDash.io is a real-time multiplayer territory game.

Players dash outside their own land, draw an exposed trail, return home to close a loop, claim territory, collect glowing orbs, and cut rival trails.

The public brand is:

> TrailDash.io — Dash out. Close the loop. Own the map.

## Requirements

- Node.js 18 or newer
- npm
- A host that supports long-lived WebSocket connections

Recommended hosts include Render, Railway, Fly.io, and other Node-compatible providers with WebSocket support.

## Local installation

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

The application uses the `PORT` environment variable when supplied.

```bash
PORT=8080 npm start
```

## Health check

The server exposes:

```text
GET /health
```

Example:

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{
  "ok": true,
  "service": "traildash.io",
  "rooms": 1,
  "players": 1
}
```

## WebSocket support

The browser client automatically uses:

- `ws://` during local HTTP development
- `wss://` when the site is served through HTTPS

The production reverse proxy must forward WebSocket upgrade requests.

## Private rooms

After joining a game, use the `ROOM` button to copy a link containing the room code:

```text
https://traildash.io/?room=ABC123
```

Players opening the same URL join the same room.

## Deployment on Render

1. Create a new Web Service.
2. Connect the Git repository containing this project.
3. Set the runtime to Node.
4. Use the build command:

   ```bash
   npm install
   ```

5. Use the start command:

   ```bash
   npm start
   ```

6. Set the health-check path to:

   ```text
   /health
   ```

7. Deploy the service.
8. Open the generated Render URL and verify that the lobby loads.
9. Open the browser developer console and confirm that the WebSocket connection succeeds.
10. Test the game from two browser windows.

Do not use a static-site-only service for the game server because the game requires Node.js and WebSocket support.

## Deployment on Railway

1. Create a new Railway project.
2. Deploy from the GitHub repository.
3. Railway detects Node.js from `package.json`.
4. Set the start command to:

   ```bash
   npm start
   ```

5. Add a public domain in the Railway service settings.
6. Configure the health check to request:

   ```text
   /health
   ```

7. Deploy and test the generated HTTPS URL.

Railway supplies the `PORT` environment variable automatically.

## Deployment on Fly.io

Install and authenticate the Fly CLI, then run:

```bash
fly launch
```

Use:

```bash
npm start
```

as the process command. Configure the Fly service to listen on the port provided by the `PORT` environment variable.

After deployment:

```bash
fly status
fly logs
```

Verify the health route:

```bash
curl https://your-fly-hostname.fly.dev/health
```

## Environment settings

Required production setting:

```text
PORT
```

The hosting provider normally supplies this value automatically.

No database, API key, or secret is required for the included game.

## DNS setup for TrailDash.io

Domain availability for `TrailDash.io` is unverified. Purchase and availability must be confirmed directly with a registrar before configuring DNS.

After deploying:

1. Add `traildash.io` as a custom domain in the hosting provider.
2. Add the DNS records requested by the host.
3. For the root domain, the provider may require an `A` record or an `ALIAS`/`ANAME` record.
4. For `www`, use the provider's requested `CNAME`.
5. If the provider gives a target such as `your-service.onrender.com`, use that exact target.
6. Remove conflicting old `A`, `AAAA`, or `CNAME` records.
7. Wait for DNS propagation.
8. Enable the provider's managed TLS certificate.
9. Confirm both URLs:

   ```text
   https://traildash.io/
   https://www.traildash.io/
   ```

10. Choose one canonical host and redirect the other to it.

The included canonical and social URLs use:

```text
https://traildash.io/
```

## Production verification checklist

- `GET /health` returns HTTP 200.
- The landing page loads over HTTPS.
- `/social-card.svg` returns HTTP 200.
- `/sitemap.xml` returns HTTP 200.
- `/robots.txt` returns HTTP 200.
- The browser uses `wss://` in production.
- Two separate browser sessions can join a room.
- The copied private-room URL opens successfully.
- No mixed-content warnings appear.
- The hosting provider is configured to keep WebSocket upgrades enabled.

## Render Blueprint

This repository includes `render.yaml` for a free Render web service. Use the one-click Render deploy link from the project publication report, sign in, and click Apply.
