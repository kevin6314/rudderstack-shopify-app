# Shopify App OAuth & Local Development Checklist

## 1. Project Structure & Configuration

- [x] Ensure `shopify.app.toml` exists in the project root and is linked to your app in the Partner Dashboard
- [x] Confirm `docker-compose.yml` and `.env` have correct values for:
  - [x] `SHOPIFY_API_KEY`
  - [x] `SHOPIFY_API_SECRET`
  - [x] `HOST` (set to your current ngrok/Cloudflare tunnel URL)
  - [x] `SHOP` (your development store domain)

## 2. Shopify Partner Dashboard Setup

- [x] App URL and Redirect URLs match your tunnel URL
- [x] Required OAuth scopes are set (read_orders, write_script_tags, etc.)
- [x] App is installed on your development store

## 3. Local Environment

- [x] Docker containers are running (`docker compose up -d`)
- [ ] Tunnel is running and forwarding to your app (ngrok or Shopify CLI tunnel)
- [x] App logs show successful startup and DB connection

## 3a. Switch to Shopify CLI Tunnel (Local Dev, No Docker)

- [x] Ensure all code and config changes are committed or backed up
- [x] Stop Docker containers if running (`docker compose down`)
- [x] Install all dependencies locally (`npm install --legacy-peer-deps`)
- [ ] Ensure `.env` and `shopify.app.toml` are up to date for local dev
- [ ] In project root, run `shopify app dev` (or `shopify app tunnel start` if already running the app)
- [ ] Confirm CLI opens a tunnel and updates Partner Dashboard URLs
- [ ] Access app via the CLI-provided tunnel URL with `?shop=<store>.myshopify.com`
- [ ] Complete OAuth flow and verify app loads in browser
- [ ] If issues, check CLI output, local logs, and browser console

## 4. OAuth Flow

- [ ] Access app via `https://<tunnel>/?shop=<store>.myshopify.com`
- [ ] Complete Shopify OAuth flow (approve app in store)
- [ ] App redirects back and loads main UI/dashboard

## 5. Debugging & Verification

- [ ] If errors occur, check:
  - [ ] App logs (local terminal output)
  - [ ] Tunnel logs (CLI output)
  - [ ] Browser console/network tab
- [ ] Verify webhooks and script tags are registered (if applicable)
- [ ] Confirm app functionality in Shopify admin

## 6. Embedded App Error Fixes

- [ ] Serve your app over HTTPS using ngrok or Shopify CLI tunnel (port 443)
- [ ] Set HOST in .env (or docker-compose) and Shopify Partner Dashboard to the tunnel URL
- [ ] Ensure your server routes all /?embedded=1&... requests to your frontend entrypoint (/)
- [ ] Use Shopify App Bridge React Provider at the root of your frontend (with apiKey and host from query params)
- [ ] Confirm App Bridge is handling redirects, HMAC, and host validation
- [ ] Test that the app loads in the Shopify admin without 'Invalid path' errors
- [ ] Verify that SendBeacon and WebSocket warnings are gone in the browser console
- [ ] Confirm no CSP or sandbox script errors in the browser console

---

**Check off each item as you complete it.**

References:

- [Shopify Scaffold App](https://shopify.dev/docs/apps/build/scaffold-app)
- [Remix Best Practices](https://shopify.dev/docs/apps/build/build?framework=remix)
- [Shopify CLI Documentation](https://shopify.dev/docs/api/shopify-cli.txt)
