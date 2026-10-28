# Okane

Personal expense tracker. Add an expense by hand, or upload a payment screenshot and let Claude read the
amount, recipient, remark and payment method and sort it into a category. Track subscriptions on a calendar.

- `server/`  FastAPI + SQLite backend, runs on your VPS. Stores entries, subscriptions and screenshots.
- `app/`  Expo (React Native) app for Android, iOS and the browser.

## How categories are picked

1. **Your corrections.** When you change an entry's category, Okane remembers it for that recipient.
2. **Keyword rules** in `server/app/categorize.py` (e.g. "warung", "GoFood" → food; "Indomaret" → groceries).
3. **Claude's guess** from the screenshot.

Manual entries always use the category you choose.

## Payment methods

Each expense can be tagged Shopee, BCA transfer or Credit card. Scans guess it from the screenshot; the home
screen totals each method for the month.

## Screenshots

Scanned screenshots are kept with their expense. You can also attach, replace or remove a screenshot on any
expense in its form, even without an AI provider; attaching only stores it, nothing reads it.

## Subscriptions

Add a subscription (monthly or yearly, with amount, category and payment method) under **calendar**. Each due
date shows on the calendar as a reminder (red dot). Tap **mark spent** to turn it into a real expense for that
date (blue dot); it then counts in your monthly totals. Undo deletes that expense again.

## Server (VPS)

```sh
cd server
docker build -t okane .
docker run -d --name okane --restart unless-stopped \
  -e OKANE_TOKEN="$(openssl rand -hex 24)" \
  -v okane-data:/data -p 127.0.0.1:8000:8000 okane
docker exec okane env | grep OKANE_TOKEN    # copy this into the app
```

Existing databases are upgraded in place on startup.

Without Docker: `pip install -r requirements.txt`, then `OKANE_TOKEN=... uvicorn app.main:app --port 8000`.

### Reading screenshots with Claude Code on the VPS (personal use)

Instead of an API key, the server can read screenshots with the Claude Code CLI (`claude -p`) using your own
Claude login. This uses your plan's usage limits and is slower than the API (several seconds per scan). Keep it
for yourself: don't share the server token with anyone else while this is on.

Claude Code lives on the VPS itself, so run the server as your user instead of in Docker:

```sh
cd ~/Okane/server
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
which claude                       # e.g. /home/you/.local/bin/claude
claude                             # log in once if you haven't
```

`/etc/systemd/system/okane.service`:

```ini
[Unit]
Description=Okane
After=network.target

[Service]
User=you
WorkingDirectory=/home/you/Okane/server
Environment=OKANE_TOKEN=paste-a-long-random-string
Environment=OKANE_DATA_DIR=/home/you/okane-data
Environment=OKANE_CLAUDE_CLI=/home/you/.local/bin/claude
ExecStart=/home/you/Okane/server/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```sh
docker cp okane:/data/. ~/okane-data/ && docker rm -f okane   # only if you ran the Docker version before
sudo systemctl daemon-reload && sudo systemctl enable --now okane
```

Then pick **On my server** in the app's settings. Caddy stays the same.

## Web app

Build the browser version and copy it to the VPS:

```sh
cd app
npx expo export -p web
scp -r dist/* you@vps:/srv/okane-web/
```

Serve it and the API from one domain with Caddy (HTTPS is automatic; Android also needs HTTPS in release
builds):

```
okane.example.com {
	@api path /health /capabilities /categories /transactions /transactions/* /subscriptions /subscriptions/*
	handle @api {
		reverse_proxy 127.0.0.1:8000
	}
	handle {
		root * /srv/okane-web
		try_files {path} /index.html
		file_server
	}
}
```

Open `https://okane.example.com`; the server URL is pre-filled, so you only paste the token.

For local testing with `npx expo start --web` (served from `localhost:8081`), start the server with
`OKANE_CORS_ORIGINS=http://localhost:8081`. Leave it unset in production.

## Phone app

```sh
cd app
npx expo start                                                    # open in Expo Go to try it
npx eas-cli@latest build --platform android --profile preview     # installable APK
```

On first launch, enter the server URL and token. Reading screenshots is optional; pick one under
"Read screenshots with":

- **On my server:** Claude Code on the VPS (see above). No key on the device.
- **Anthropic:** your API key; Claude (`claude-opus-5-5`) reads the receipt for a fraction of a cent.
- **OpenRouter / Gemini / OpenAI:** your API key plus a model name that can read images.
- **None:** add each expense with "+ manual".

You can change any of these later under settings.

### Updates

Pushing changes under `app/` to `main` runs `.github/workflows/app-update.yml`, which publishes an EAS Update;
the installed app picks it up on its next launch. One-time setup: `npx eas-cli@latest login` and
`npx eas-cli@latest init` in `app/`, build and install the preview APK, and add an Expo access token as the
`EXPO_TOKEN` repository secret. Adding a native package needs a new APK build.

## Privacy

- On the phone, the token and API key live in secure storage. In the browser they live in that site's
  localStorage, so only sign in on your own computer.
- An AI API key is sent to your server with each scan and passed to that provider; the server never writes it to disk.
- Screenshots and the database live only on your VPS in the `/data` volume. Screenshots are served only with the token.
- The model is asked to leave account numbers out of the recipient field, but the full image is still sent to
  whichever provider reads it (or to Claude Code on your VPS, which sends it to Anthropic).
