# Hosting `server3` on a Hostinger VPS

A step-by-step plan to migrate the Honda Golaghat backend (`server3/`) from Google
Cloud Run to a Hostinger VPS (KVM plan, Ubuntu 22.04/24.04).

The app is an **Express 5 + TypeScript** service:

- Build: `npm run build` (`tsc` → `dist/`)
- Start: `npm start` (`node dist/server.js`)
- Listens on `process.env.PORT || 8080`
- External deps: MongoDB (via `MONGO_URI`, typically Atlas), Firebase Admin,
  Cloudinary, ScanFleet, SMTP, Anthropic/Voyage.

The target architecture on the VPS:

```
Internet ──▶ Nginx (443/80, TLS) ──▶ Node app (PM2, 127.0.0.1:8080)
                                          └─▶ MongoDB Atlas (external)
```

Keep MongoDB on Atlas for now — do **not** self-host Mongo on the same small VPS
unless you deliberately choose to (see the optional section at the end).

---

## 0. Prerequisites

- A Hostinger **VPS** plan (KVM 1 or higher; KVM 2 recommended — the app parses
  XLSX/PDF and runs AI calls, so give it ≥2 GB RAM).
- A domain or subdomain you control (e.g. `api.hondagolaghat.com`) that you can
  point at the VPS IP.
- The current `server3/.env` contents (all secrets — you will recreate this file
  on the server; it is **not** in git).
- If Atlas has IP allowlisting enabled, you'll need the VPS's public IP to add it.

---

## 1. Provision the VPS

1. In hPanel → **VPS** → create/deploy with **Ubuntu 24.04 (64-bit)** (a plain OS
   template, not a pre-baked app template).
2. Set a strong root password / upload an SSH key during setup.
3. Note the VPS **public IPv4 address**.

## 2. Point DNS at the VPS

In your DNS provider (or Hostinger's DNS if the domain is there):

- `A` record: `api` → `<VPS_IP>` (TTL 300 while migrating).

Wait for it to resolve (`dig api.hondagolaghat.com +short`) before requesting TLS
in step 8.

## 3. Initial server hardening

SSH in as root, then:

```bash
# Create a non-root deploy user
adduser deploy
usermod -aG sudo deploy

# Copy your SSH key to the new user (from your laptop, or set a password)
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy

# Basic firewall
apt update && apt install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Keep the system patched
apt -y upgrade
```

Optional but recommended: disable root SSH login and password auth in
`/etc/ssh/sshd_config` (`PermitRootLogin no`, `PasswordAuthentication no`), then
`systemctl restart ssh`. From here on, work as `deploy`.

## 4. Install the Node runtime

Use Node 22 LTS (matches `@types/node ^22`):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node -v   # v22.x
npm -v
```

Install PM2 (process manager — keeps the app alive, restarts on crash/reboot):

```bash
sudo npm install -g pm2
```

## 5. Get the code onto the server

Pick one approach:

**A. Git clone (preferred)** — if the backend has its own remote:

```bash
cd /home/deploy
git clone <your-server3-repo-url> app
cd app          # if server3 is a subdirectory, cd into it
```

> Note: in this repo, `server3/` is its own git repository (separate from
> `client/`). Clone whatever remote holds `server3`. If it has no remote yet,
> push it to GitHub/GitLab first, or use approach B.

**B. Manual copy (no remote)** — from your laptop:

```bash
# Exclude node_modules, dist, .env, logs — rebuild on the server
rsync -avz --exclude node_modules --exclude dist --exclude '.env' \
  --exclude '*.log' --exclude '.git' \
  ./server3/ deploy@<VPS_IP>:/home/deploy/app/
```

## 6. Recreate the `.env` file

`.env` is gitignored and holds all secrets, so it must be created by hand on the
server. Create `/home/deploy/app/.env` with the same keys as your local one:

```
PORT=8080
NODE_ENV=production
MONGO_URI=...
JWT_SECRET=...
JWT_EXPIRE=15m
REFRESH_TOKEN_SECRET=...
REFRESH_TOKEN_EXPIRES_IN=30d
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
FRONTEND_URL=https://<your-vercel-frontend-domain>
RATE_LIMIT_WINDOW_MS=...
RATE_LIMIT_MAX_REQUESTS=...
LOG_LEVEL=info
FIREBASE_PROJECT_ID=...
FIREBASE_PRIVATE_KEY_ID=...
FIREBASE_PRIVATE_KEY="..."   # keep the \n-escaped multiline value quoted
FIREBASE_CLIENT_EMAIL=...
FIREBASE_CLIENT_ID=...
SCANFLEET_BASE_URL=...
SCANFLEET_API_KEY=...
SCANFLEET_API_SECRET=...
SMTP_HOST=...
SMTP_PORT=...
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM_NAME=...
SMTP_FROM_EMAIL=...
VOYAGE_API_KEY=...
VOYAGE_MODEL=...
ANTHROPIC_RAG_STRUCTURED_MODEL=...
ANTHROPIC_RAG_SEMANTIC_MODEL=...
ANTHROPIC_API_KEY=...
```

Lock down permissions: `chmod 600 /home/deploy/app/.env`.

> **Firebase key gotcha:** `FIREBASE_PRIVATE_KEY` contains literal `\n`. Keep it
> wrapped in double quotes exactly as in your working local `.env`; the app
> already un-escapes it.

## 7. Build and smoke-test

```bash
cd /home/deploy/app
npm ci                 # clean install from package-lock.json
npm run build          # tsc → dist/
node dist/server.js    # should log: Server running on http://localhost:8080
```

In another SSH session: `curl -i http://localhost:8080/` (or a known health/route)
to confirm it responds and connected to Mongo. Then `Ctrl-C` to stop.

If Atlas blocks the connection, add the VPS public IP to the Atlas
**Network Access** allowlist.

## 8. Run under PM2

```bash
cd /home/deploy/app
pm2 start dist/server.js --name honda-server --time
pm2 save                       # persist process list
pm2 startup systemd            # prints a command — run the printed sudo command
```

Now the app auto-starts on reboot and restarts on crash. Useful commands:

```bash
pm2 status
pm2 logs honda-server
pm2 restart honda-server
```

## 9. Reverse proxy with Nginx + TLS

```bash
sudo apt install -y nginx
```

Create `/etc/nginx/sites-available/honda-server`:

```nginx
server {
    listen 80;
    server_name api.hondagolaghat.com;

    client_max_body_size 25m;   # multer uploads (XLSX/CSV/PDF) need headroom

    location / {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;   # AI/parse routes can be slow
    }
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/honda-server /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Add TLS with Let's Encrypt (free, auto-renewing):

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.hondagolaghat.com
```

Certbot rewrites the vhost for 443 and sets up auto-renewal (`certbot renew`
runs via systemd timer).

> **`trust proxy`:** because the app now sits behind Nginx, `express-rate-limit`
> and any IP logging see `127.0.0.1` unless Express trusts the proxy. Confirm
> `app.set('trust proxy', 1)` is set in `src/server.ts` — if not, add it so
> rate limiting keys on the real client IP from `X-Forwarded-For`.

## 10. Wire up the frontend

1. In the client's Vercel project, set `VITE_API_BASE_URL` to
   `https://api.hondagolaghat.com/api` and redeploy.
2. On the server, ensure `FRONTEND_URL` (used by CORS) matches the Vercel domain.
   Verify the CORS config in `src/server.ts` allows that origin, then
   `pm2 restart honda-server`.
3. Test a real login + an authenticated request end-to-end from the deployed
   frontend before cutting DNS fully over.

## 11. Cutover & decommission

- Once verified, lower/keep the DNS TTL and let traffic flow to the VPS.
- Keep Cloud Run running in parallel for a day or two as a fallback.
- After confidence, delete/scale-down the Cloud Run service to stop billing.

---

## Operations

**Deploying updates:**

```bash
cd /home/deploy/app
git pull                 # or rsync again for approach B
npm ci
npm run build
pm2 restart honda-server
```

Consider a small `deploy.sh` wrapping the above.

**Logs:** app writes `combined.log` / `error.log` (Winston) in the app dir, plus
`pm2 logs`. Add log rotation so they don't fill the disk:

```bash
pm2 install pm2-logrotate
```

and rotate Winston's own files (logrotate config in `/etc/logrotate.d/` or cap
sizes in the Winston transport).

**Backups:** nothing app-critical lives on the VPS except `.env` — back that up
securely (password manager / encrypted store). Data lives in Atlas (use Atlas
backups). Uploaded images go to Cloudinary.

**Monitoring:** `pm2 status`, optionally `pm2 monit`. For uptime alerts, add an
external pinger (UptimeRobot / BetterStack) hitting a health route over HTTPS.

**Security checklist:**
- `.env` is `chmod 600`, owned by `deploy`.
- UFW only exposes 22/80/443.
- App binds to `127.0.0.1:8080` (behind Nginx) — never expose 8080 publicly.
- Keep `unattended-upgrades` on for security patches.
- Rotate any secrets that were previously stored in Cloud Run only.

---

## Optional: self-hosting MongoDB on the VPS

Only if you want to drop Atlas. Requires more RAM and disciplined backups.

```bash
# Install MongoDB 7 (Ubuntu 24.04)
sudo apt install -y gnupg curl
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | \
  sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update && sudo apt install -y mongodb-org
sudo systemctl enable --now mongod
```

Then:
- Create an admin user + a dedicated app user, enable auth (`security.authorization: enabled` in `/etc/mongod.conf`).
- Keep `bindIp: 127.0.0.1` so Mongo is not internet-exposed; point `MONGO_URI`
  at `mongodb://<user>:<pass>@127.0.0.1:27017/<db>`.
- Set up `mongodump` cron backups to off-box storage.
- Migrate data with `mongodump` from Atlas → `mongorestore` on the VPS.

For a single small dealership VPS, **Atlas is usually the safer default** — it
handles backups, patching, and replication for you.

---

## Quick reference

| Item | Value |
|---|---|
| Runtime | Node 22 LTS |
| Build | `npm run build` (`tsc` → `dist/`) |
| Start | `node dist/server.js` |
| App port | `8080` (bind localhost) |
| Process manager | PM2 (`honda-server`) |
| Reverse proxy | Nginx :443 → 127.0.0.1:8080 |
| TLS | Let's Encrypt / certbot |
| Database | MongoDB Atlas (external) |
| Secrets | `/home/deploy/app/.env` (chmod 600) |
| Upload size cap | `client_max_body_size 25m` in Nginx |
