# WLS Statement Invoice

Vue + Vite app for WLS expense statements, expense reports, mileage logs, work logs, and receipts.

## Local Development

```bash
npm install
npm run dev
```

The frontend uses Vercel API routes under `/api/projects`, `/api/auth`, and `/api/members`. In plain Vite development, the app shell loads but the MongoDB API routes are not available.

For full local API testing, run with Vercel and provide MongoDB environment variables:

```bash
MONGODB_URI="mongodb+srv://..." \
MONGODB_DB="wls_statement_invoice" \
vercel dev
```

## Environment Variables

Set these in Vercel for preview/production deployments:

```txt
MONGODB_URI=
MONGODB_DB=wls_statement_invoice
MONGODB_PROJECTS_COLLECTION=projects
MONGODB_MEMBERS_COLLECTION=members
MONGODB_SESSIONS_COLLECTION=sessions
MONGODB_RECEIPTS_BUCKET=receipt_images
ADMIN_NAME=
ADMIN_PIN=
ADMIN_ACCOUNT_NUMBER=
GEOAPIFY_API_KEY=
```

Do not commit real MongoDB credentials or admin PINs. If `ADMIN_PIN` is not set and no members exist, the app shows a one-time first-admin setup screen. After the first admin exists, members sign in with account number + PIN.

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
