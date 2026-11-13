# Test environment on your own computer (Windows)

Runs the whole SlabGuard app on your Windows PC with Docker, and gives it a fixed public https address through **ngrok's free static domain**. Testers can use the website and the staging mobile app while your PC is on. **Cost: $0.**
- **Your PC:** website, background workers, image analysis, database and Redis, in Docker.
- **Supabase (free plan):** sign-in, and photo storage.
- **ngrok (free plan):** the public address, for example `https://your-name.ngrok-free.app`.

**What you give up compared with hosting (Fly.io):**
- Testers can reach it only while your PC is **on, awake and running Docker**.
- ngrok's free plan has monthly data and request limits: plenty for a small group of testers, not for a load test. Check ngrok's pricing page for the current numbers.
- The first time someone opens the site in a browser, ngrok shows a **warning page**; they click **Visit Site**, once per browser. The mobile app and Stripe's webhooks don't see this page.
- The database lives on your PC. To reset it, see "Day to day" below.

Everything is in `docker-compose.yml`, configured by a `.env` file. CI starts the same setup on every push and checks it comes up healthy (the `compose` job).

## 1. Install (once)
1. **Docker Desktop for Windows** (docker.com). Use the **WSL 2** option when asked.
   - In Docker Desktop **Settings → General**, tick **Start Docker Desktop when you sign in**.
   - The app needs about **4 GB of memory** while running. Docker Desktop normally gets half your PC's memory, which is enough on a 16 GB PC.
2. **Git for Windows** (git-scm.com). The default options are fine.

## 2. Get the code (once)
Open **PowerShell**:

```bash
git clone https://github.com/ericruano127/SlabSentry.git
```

```bash
cd SlabSentry
```

The repository is private, so Git asks you to sign in to GitHub the first time, in a browser window.

## 3. ngrok (once, free)
1. Sign up at **ngrok.com**, ideally with two-factor authentication on.
2. In the ngrok dashboard, open **Domains** and claim your **free static domain**, for example `your-name.ngrok-free.app`.
3. Copy **Your Authtoken** from the dashboard. It's a secret: it goes only in `.env`.

You don't need to install ngrok; it runs inside Docker.

## 4. Supabase (once, free)
1. Sign up at **supabase.com** and create a **new project** (a region near you). Keep the database password somewhere safe; the app doesn't need it.
2. **Storage:** create a bucket named **`slab-images`**, and keep it **private** (the "public bucket" switch off).
3. **Authentication → URL Configuration:**
   - **Site URL:** `https://your-name.ngrok-free.app`
   - **Redirect URLs:** add all three:
     - `https://your-name.ngrok-free.app/auth/callback`
     - `https://your-name.ngrok-free.app/reset-password`
     - `slabguard-staging://**` (the staging mobile app)
4. **Authentication → Sign In / Providers → Email:** keep **Confirm email** on.
5. Recommended: turn off **Allow new users to sign up**, then add testers yourself under **Authentication → Users → Invite user**. Otherwise anyone who finds the address can create an account.
6. **Google or Apple sign-in:** optional, and can wait. When you add them, they use the same redirect URLs (`docs/MOBILE_BUILDS.md` covers the Apple client ID for the app).
7. Copy from **Project Settings → API**: the **Project URL**, the **anon (publishable)** key, and the **service_role (secret)** key.

## 5. Your settings file
In the `SlabSentry` folder:

```bash
copy local-staging.env.example .env
```

```bash
notepad .env
```

Fill in:
- **ngrok:** your domain (twice: `NGROK_DOMAIN` and `APP_URL`, the second with `https://`) and the authtoken.
- **Supabase:** the three Supabase values.
- **You:** your email in `ADMIN_EMAILS`.
- **Two random values:** the file shows a PowerShell one-liner that generates them.

Save. **Never commit `.env` or paste it into chat**; git already ignores it.

## 6. Start it

```bash
docker compose --profile tunnel up -d --build
```

The first build takes 10–20 minutes; later starts take seconds. To see whether everything is up:

```bash
docker compose ps
```

All services should say **running** or **healthy**, and `migrate` should have **exited (0)** after setting up the database.

Then open your address (`https://your-name.ngrok-free.app`). Click **Visit Site** on ngrok's warning page, then **sign up with the email in `ADMIN_EMAILS`**. That account becomes the staff owner. Staff tools need two-factor: enable it under Account → Security, then sign in again.

## Day to day

| To… | Run (in the `SlabSentry` folder) |
|---|---|
| Stop (keeps all data) | `docker compose --profile tunnel down` |
| Start again | `docker compose --profile tunnel up -d` |
| Update to the latest code | `git pull`, then `docker compose --profile tunnel up -d --build` |
| Apply a changed setting in `.env` | `docker compose --profile tunnel up -d` (add `--build` if you changed the ngrok domain or the Supabase URL or anon key: they're built into the website) |
| See what's happening | `docker compose logs -f web worker` (Ctrl+C to stop watching) |
| **Delete everything and start fresh** | `docker compose --profile tunnel down -v` (deletes the database: all accounts' scans and reports) |

**Keep the PC awake while testers use it:** Settings → System → Power → Screen and sleep → when plugged in, put the device to sleep after **Never**.

## Testers
- Send them the address and the shared checklist (`docs/MANUAL_TEST_PLAN.md`). Invite them in Supabase if you turned off sign-ups.
- **Email links:** ask testers to open the site once before clicking the confirmation email. If a confirmation link lands on ngrok's warning page, click Visit Site. The email is confirmed either way, and they can then sign in normally.
- **Mobile app:** use `https://your-name.ngrok-free.app` as `EXPO_PUBLIC_API_URL`, and your Supabase URL and anon key, in the EAS **preview** environment. Then build staging (`docs/MOBILE_BUILDS.md`).

## Optional: Stripe test purchases
1. In Stripe (**test mode**), create the products and prices (`docs/DEPLOYMENT.md` § Stripe).
2. Add a webhook endpoint `https://your-name.ngrok-free.app/api/webhooks/stripe` with API version **`2026-10-28.endive`** and the events listed there.
3. Put `sk_test_…` and the endpoint's `whsec_…` in `.env`, then run `docker compose --profile tunnel up -d`.
4. Pay with the test card `4242 4242 4242 4242`.

## If something goes wrong

| What you see | What to do |
|---|---|
| `web` keeps restarting | `docker compose logs web`. A line starting **"Refusing to start"** lists exactly which settings are missing in `.env` |
| `migrate` exited with an error | `docker compose logs migrate`. Usually Docker ran out of disk or memory; free some up and start again |
| ngrok errors such as `ERR_NGROK_…` | `docker compose logs tunnel`. Check `NGROK_AUTHTOKEN`, and that `NGROK_DOMAIN` is exactly your claimed domain, without `https://` |
| Sign-in fails or loops | The Supabase **Site URL** and **Redirect URLs** must use your exact ngrok address. If you changed the Supabase URL or anon key, rebuild with `--build` |
| Photos fail to upload | The Supabase bucket must be named exactly `slab-images`, and `SUPABASE_SERVICE_ROLE_KEY` must be the service_role key, not the anon key |
| "Docker Desktop is not running" | Start Docker Desktop and wait until it says Running |

Send me the log lines (never `.env` or keys) and I'll help.

## Later: moving to hosting
When you want staging up around the clock, with automatic deploys after CI, the same app runs on Fly.io (`docs/STAGING_FLY.md`). The Supabase project can stay the same; only the address changes in its redirect URLs.
