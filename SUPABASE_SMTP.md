# Supabase Custom SMTP (Resend)

How to make Supabase send auth emails (password reset, signup confirm, magic link) from `info@cafelytic.com` via Resend instead of the default `noreply@mail.app.supabase.io`. The default SMTP lands reset emails in Gmail spam — this fixes that.

## Provider

[Resend](https://resend.com) — purpose-built for transactional email. Free tier covers 3,000 emails/month and 100/day, more than cafelytic.com will use.

## Why not Zoho

`info@cafelytic.com` is a Zoho mailbox; sending app traffic through it works but burns the daily 50-email outbound limit and shares deliverability reputation with regular human mail. Resend keeps the two pipes separate so a viral spike in resets can't break your inbox and a misconfigured filter on the Zoho side can't drop a password reset.

## One-time setup

### 1. Sign up at resend.com

Use the cafelytic admin email. No credit card required for the free tier.

### 2. Verify the cafelytic.com domain

Resend dashboard → **Domains → Add Domain** → `cafelytic.com`. Resend will show three DNS records to add:

| Type | Host | Value |
|---|---|---|
| `MX` | `send.cafelytic.com` (or whatever subdomain Resend specifies) | `feedback-smtp.<region>.amazonses.com` (priority 10) |
| `TXT` | `send.cafelytic.com` | `v=spf1 include:amazonses.com ~all` |
| `TXT` | `resend._domainkey.cafelytic.com` | (long DKIM public key from Resend) |

Add them at your DNS provider (whoever cafelytic.com points its nameservers at). Click **Verify** in Resend — typically goes green within a few minutes, can take up to an hour for DNS propagation.

**Do not skip DKIM.** Without it, Gmail will keep filtering us into spam regardless of which SMTP we use.

### 3. Create a Resend API key

Resend dashboard → **API Keys → Create API Key** → name it `supabase-prod`, scope **Sending access** for cafelytic.com only. Copy the key — Resend only shows it once.

### 4. Configure Supabase SMTP

[Supabase Dashboard → Auth → SMTP Settings](https://supabase.com/dashboard/project/srlwgayrxzamxlodpsrq/settings/auth)

Toggle **Enable Custom SMTP** and enter:

| Field | Value |
|---|---|
| Sender email | `info@cafelytic.com` |
| Sender name | `Cafelytic` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | (the API key from step 3) |
| Minimum interval between emails | leave default (60s) |

Save.

### 5. Verify

Trigger a password reset for a test account from `cafelytic.com/login.html`. The email should:

- Arrive within a few seconds (default Supabase SMTP often takes a minute+)
- Land in the inbox, not spam
- Show **From**: `Cafelytic <info@cafelytic.com>`
- Click-through still works — the link target is unchanged (`https://cafelytic.com/reset-password.html#access_token=…`)

If the email doesn't arrive: check Resend dashboard → **Logs** — every send attempt is recorded with delivery status, bounces, and complaints.

## Email templates

Supabase dashboard → **Auth → Email Templates** controls the body. Defaults work fine for password reset (see [SUPABASE_PLAN.md](SUPABASE_PLAN.md) for the broader template story). When customizing:

- Always include `{{ .ConfirmationURL }}` — that's the link with the recovery hash.
- `{{ .Email }}`, `{{ .SiteURL }}` are also available.
- Keep the plain-text version in sync with the HTML — Resend uses the HTML for inboxes that support it and the text for the rest.

## Operational notes

- **Quota**: Resend's free tier resets daily (100/day) and monthly (3,000/mo). Cafelytic-scale traffic should sit well under both, but the dashboard shows current usage. If we ever push the daily cap, password resets silently fail — same failure mode as the Supabase default.
- **Bounces / complaints**: Resend automatically suppresses addresses that bounce hard or mark us as spam. If a real user reports they can't receive resets, check **Resend → Suppressions** before debugging anything else.
- **Rotating the key**: revoke in Resend, generate a new one, paste into Supabase. Rotation is zero-downtime — Supabase reads the credential per-send.
- **DNS records**: don't remove them when you do unrelated DNS work. Without DKIM, every cafelytic.com auth email starts going to spam again silently.

## What to do if SMTP breaks

Symptoms: users report not receiving auth emails, no error in app, Resend logs show no recent sends.

1. Confirm the API key in Supabase still works — paste a fresh one from Resend, save.
2. Confirm the sender domain still verifies in Resend (DNS records intact).
3. Toggle **Enable Custom SMTP** off, save, toggle on, save — Supabase has cached bad credentials before.
4. Last resort: toggle off entirely. Supabase falls back to its built-in SMTP. Auth emails will start landing in spam again but will at least be sent. Then debug Resend separately.
