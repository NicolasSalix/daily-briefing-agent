# Daily Briefing Agent

Sends a daily email with prioritized tasks (from Notion) + calendar (from Google Calendar), analyzed by Claude.

---

## How to test locally

1. Install Node.js from https://nodejs.org (LTS version)
2. Open a terminal in this folder and run:

```bash
npm install
```

3. Create a `.env` file (never commit this):

```
ANTHROPIC_API_KEY=sk-ant-...
NOTION_API_KEY=secret_...
CALENDAR_TOKEN=1//0h...          # refresh token from calendar_token.txt
GOOGLE_CLIENT_ID=719657498900-...
GOOGLE_CLIENT_SECRET=GOCSPX-...
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
```

4. Load the env and run in test mode (no email sent):

```bash
# On Windows PowerShell:
Get-Content .env | ForEach-Object { $k,$v = $_ -split '=',2; [System.Environment]::SetEnvironmentVariable($k,$v) }
node daily_briefing_agent.js --test

# On Mac/Linux:
export $(cat .env | xargs) && node daily_briefing_agent.js --test
```

---

## How to get a Gmail App Password

1. Go to https://myaccount.google.com/security
2. Make sure 2-Step Verification is ON for ngspielmann@gmail.com
3. Search for "App passwords" in the search bar
4. Click "App passwords" → select "Mail" and "Other (custom name)" → type "Daily Briefing Agent"
5. Click Generate → copy the 16-character password (format: `xxxx xxxx xxxx xxxx`)
6. Add it to GitHub Secrets as `GMAIL_APP_PASSWORD`

---

## GitHub Secrets to add

Go to your GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret name          | Value                                                                 |
|----------------------|-----------------------------------------------------------------------|
| `ANTHROPIC_API_KEY`  | Your Claude API key from console.anthropic.com                        |
| `NOTION_API_KEY`     | Your Notion integration token (secret_...)                            |
| `CALENDAR_TOKEN`     | Google Calendar refresh token (from calendar_token.txt on Desktop)    |
| `GOOGLE_CLIENT_ID`   | From your `credentials.json` → `client_id` field                             |
| `GOOGLE_CLIENT_SECRET` | From your `credentials.json` → `client_secret` field                      |
| `GMAIL_APP_PASSWORD` | 16-char App Password generated above                                  |

---

## How to deploy to GitHub

```bash
git add .
git commit -m "Complete Daily Briefing Agent"
git push
```

The workflow will run automatically at 11:00 UTC (8:00 AM São Paulo) every day.

---

## How to view logs

1. Go to your GitHub repo → **Actions** tab
2. Click on a workflow run → click "send-briefing" → expand "Run Daily Briefing Agent"

To trigger manually: Actions tab → "Daily Briefing" → "Run workflow"

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Notion error: Could not find database` | Make sure your Notion integration is connected to the database (Share → Invite → your integration) |
| `Calendar error: invalid_grant` | Your refresh token expired — re-run the `get_calendar_token.py` script on your Desktop |
| `Gmail error: Invalid login` | App Password is wrong or 2FA is off — regenerate the App Password |
| `Claude error: authentication_error` | Check your `ANTHROPIC_API_KEY` secret |
| Tasks show as "Unknown" status | Check your Notion Status property name matches exactly: "Status" |
