# Hosting Tonk

The server is one long-running Node process (HTTP + WebSockets) that keeps all games in memory. Run **exactly one instance**; restarting it drops every game. Anything that can run Node and allows WebSockets works (a VPS, Render/Railway/Fly.io, a Raspberry Pi, ...). Static-only and serverless hosts do not.

This guide covers a Raspberry Pi 4 exposed to the internet with a Cloudflare Tunnel.

## 1. Run the server on the Pi

1. Use 64-bit Raspberry Pi OS and install Node 18 or newer:
   ```
   sudo apt update && sudo apt install -y nodejs npm
   node -v        # must be v18 or higher
   ```
2. Get the code onto the Pi (`git clone` of the GitHub repo, or copy the folder with `scp`/`rsync`), then:
   ```
   cd ~/bc-tonk
   npm ci --omit=dev
   npm start
   ```
3. From another device on your network open `http://<pi-ip>:3100` (not `localhost`, which means "this device"). The server prints the addresses it can be reached at when it starts: `journalctl -u <service> -n 20`, or `hostname -I` on the Pi. It should work.

### Keep it running (systemd)

Create `/etc/systemd/system/tonk.service` (adjust `User` and the paths):

```ini
[Unit]
Description=Tonk card game
After=network.target

[Service]
User=pi
WorkingDirectory=/home/pi/bc-tonk
ExecStart=/usr/bin/node server/index.js
Environment=PORT=3100
Environment=HOST=127.0.0.1
Environment=TRUST_PROXY=1
Restart=always

[Install]
WantedBy=multi-user.target
```

```
sudo systemctl daemon-reload
sudo systemctl enable --now tonk
sudo systemctl status tonk      # logs: journalctl -u tonk -f
```

`HOST=127.0.0.1` makes the server reachable only from the Pi itself (so only the tunnel can reach it) and `TRUST_PROXY=1` tells it to read the real visitor address from Cloudflare's headers for the per-visitor limits. **Only set `TRUST_PROXY=1` when the server is reachable solely through the tunnel**, otherwise visitors can fake their address. For direct LAN access instead, remove both lines.

## 2. Cloudflare Tunnel

A tunnel lets the Pi make an outbound connection to Cloudflare, so you need no port forwarding, your home IP stays hidden, and you get HTTPS for free. WebSockets work through it.

### Option A: quick test link (no account, no domain)

```
cloudflared tunnel --url http://localhost:3100
```

It prints a random `https://<words>.trycloudflare.com` address that works until you stop the command. Good for a first test; the address changes every time.

### Option B: permanent address on your own domain (recommended)

Prerequisites: a free Cloudflare account and a **domain added to Cloudflare** (its DNS managed there). A domain costs roughly $10 a year; Cloudflare Registrar sells them at cost.

1. In the Cloudflare dashboard go to **Networking > Tunnels** and choose **Create a tunnel**. Give it a name (for example `tonk-pi`) and select **Create Tunnel**. (The first time, Cloudflare may walk you through Zero Trust setup, which can ask for a team name and a payment method even on the free plan.)
2. Choose **Debian**, **arm64**, and copy the install command shown. Run it on the Pi. It installs `cloudflared` and registers it as a service that starts at boot. The dashboard shows when the tunnel is connected; select **Continue**.
3. Open your tunnel, go to the **Routes** tab, select **Add route**, then **Published application**:
   - **Subdomain**: for example `tonk`
   - **Domain**: pick your domain, giving `tonk.yourdomain.com`
   - **Service URL**:    `http://localhost:3100`
4. Select **Add route**. Open `https://tonk.yourdomain.com`. The tunnel should show as **Healthy**.

(Dashboard labels move around occasionally; Cloudflare's guide is "Create a tunnel (dashboard)" in their Tunnel docs.)

### Checking it works

- Open the address on your phone using mobile data, enter a name, create a game, and add a bot.
- Pi side: `sudo systemctl status tonk` and `sudo systemctl status cloudflared`.
- If the page loads but games never connect, check that **WebSockets** is on for your domain in the Cloudflare dashboard (it is on by default).

## 3. Abuse limits

These protect a public server. All have safe defaults and can be changed with environment variables (add `Environment=NAME=value` lines to the systemd unit, then `sudo systemctl restart tonk`).

| What | Default | Variable |
| --- | --- | --- |
| Browsers from other websites opening connections | Refused unless the Origin matches the site's own address | `ALLOWED_ORIGINS` (comma-separated extra origins) |
| Simultaneous connections per visitor address | 12 | `MAX_CONNECTIONS_PER_IP` |
| New connections per visitor address per minute | 60 | `CONNECTS_PER_MINUTE_PER_IP` |
| Messages per connection per 5 seconds (over the limit: disconnected) | 60 | `MESSAGES_PER_5_SECONDS` |
| Total simultaneous connections | 300 | `MAX_CONNECTIONS` |
| Total games at once | 100 | `MAX_ROOMS` |
| A game nobody has touched for this long is closed (everyone gets a warning 2 minutes before) | 30 minutes | `ROOM_IDLE_MINUTES` |
| Games one player can create per minute | 5 | (built in) |
| Chat messages per player per 5 seconds | 5 | (built in) |
| Chat message length / name length / message size | 200 / 20 / 4 KB | (built in) |

Other variables: `PORT` (default 3100), `HOST` (default: all interfaces), `TRUST_PROXY` (see above).

Not covered: there is no login, banning across games, or moderation of names and chat. Cloudflare itself absorbs ordinary traffic floods. Games that are connected but untouched are handled by the idle timeout above; the host can also remove players (**Kick**).

## 4. Updating

```
cd ~/bc-tonk
git pull               # or copy the new files over
npm ci --omit=dev
sudo systemctl restart tonk
```

Restarting drops all games in progress, so pick a quiet moment.

## Other hosts

Render, Railway, Koyeb, Fly.io, or any VPS work the same way: run `npm start`, keep a single instance always on (no scale-to-zero, no autoscaling), allow WebSockets, and use the host's HTTPS. Leave `TRUST_PROXY` unset unless you know the host's proxy sets a trustworthy client-address header.
