# WLS Statement Invoice

Vue + Vite app for WLS expense statements, expense reports, mileage logs, work logs, and receipts.

## Local Development

```bash
npm install
npm run dev
```

The frontend loads from `/api/report`. In plain Vite development, the app falls back to browser `localStorage` if the API is unavailable.

For full local API testing, run with Vercel and provide MongoDB environment variables:

```bash
MONGODB_URI="mongodb+srv://..." \
MONGODB_DB="wls_statement_invoice" \
MONGODB_COLLECTION="reports" \
vercel dev
```

## Environment Variables

Set these in Vercel for preview/production deployments:

```txt
MONGODB_URI=
MONGODB_DB=wls_statement_invoice
MONGODB_COLLECTION=reports
```

Do not commit real MongoDB credentials. The app uses one shared document with `workspaceId: "default"`.

## Build

```bash
npm run build
```

Vercel settings:

```txt
Framework: Vite
Build command: npm run build
Output directory: dist
Install command: npm install
```
