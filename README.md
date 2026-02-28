# StrikerForge Lab

StrikerForge Lab is a football quiz + AI assistant app built with React/Vite and GenLayer Intelligent Contracts.

## What This App Does

- League quiz sessions from GenLayer contracts (`easy`, `mid`, `hard`)
- Player-focused quiz sessions from a dedicated GenLayer contract
- AI chat endpoint backed by a GenLayer AI contract
- Dynamic parsing/rendering of contract JSON responses

## Architecture

- Frontend: React + Vite (`src/components`, `src/pages`, `src/lib/strikerLegacyEngine.ts`)
- API layer: Hono app in `src/integrations/app.ts`
- GenLayer client/wrapper: `src/integrations/genlayer.ts`
- Dev proxy: `vite.config.ts` forwards `/api/*` to the Hono app
- Serverless entry (Vercel style): `api/[[...route]].ts`

All GenLayer calls run server-side through `/api/*` wrappers.

## Contract Routing

Quiz difficulty selects the league contract address:

- `easy` -> `VITE_GENLAYER_CONTRACT_LEAGUE_EASY`
- `medium` (normalized to `mid`) -> `VITE_GENLAYER_CONTRACT_LEAGUE_MID`
- `hard` -> `VITE_GENLAYER_CONTRACT_LEAGUE_HARD`

Player quiz and AI chat use dedicated addresses:

- `VITE_GENLAYER_CONTRACT_PLAYER_QUIZ`
- `VITE_GENLAYER_CONTRACT_AI_CHAT`

## Prerequisites

- Node.js 18+
- pnpm 10+

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Configure environment variables in `.env.local` (or `.env`):

```env
VITE_GENLAYER_KEY=0x...
VITE_GENLAYER_CONTRACT_AI_CHAT=0x...
VITE_GENLAYER_CONTRACT_LEAGUE_EASY=0x...
VITE_GENLAYER_CONTRACT_LEAGUE_MID=0x...
VITE_GENLAYER_CONTRACT_LEAGUE_HARD=0x...
VITE_GENLAYER_CONTRACT_PLAYER_QUIZ=0x...
```

3. Start development server:

```bash
pnpm dev
```

App runs at `http://localhost:8080`.

## Scripts

- `pnpm dev` - run Vite dev server
- `pnpm build` - production build
- `pnpm build:dev` - development-mode build
- `pnpm preview` - preview production build
- `pnpm lint` - run ESLint
- `pnpm test` - run Vitest once
- `pnpm test:watch` - run Vitest in watch mode

## API Endpoints

- `GET /api/leagues`
- `GET /api/players/popular`
- `GET /api/quiz/:category/:difficulty?count=10`
- `POST /api/quiz/validate`
- `POST /api/ai/chat`
- `POST /api/ai/player-quiz`

Use `?debug=1` or header `x-debug-receipt: true` on supported routes to include receipt/debug payloads.

## GenLayer Runtime Notes

- Chain defaults to `studionet`
- Consensus init is singleton-based (`initializeGenLayer`)
- Transaction wait policy:
  - `status: "ACCEPTED"`
  - `retries: 150`
  - `interval: 2000`

## Troubleshooting

### `vite` is not recognized

Run:

```bash
pnpm install
pnpm dev
```

If install was interrupted, remove `node_modules` and reinstall.

### `Cannot find package 'hono'`

Install dependencies again:

```bash
pnpm install
```

### pnpm warns about ignored build scripts

If prompted, allow required builds:

```bash
pnpm approve-builds
```
