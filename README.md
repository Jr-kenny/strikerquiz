# strikerlab

Football quiz app with:
- Vite frontend
- Hono API routes (`/api/*`)
- Vercel deployment

## Local development

```bash
# .env
# VITE_GENLAYER_KEY=0xYOUR_PRIVATE_KEY

npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Deploy (Vercel)

```bash
npx vercel --prod
```

## API endpoints

- `GET /api/leagues`
- `GET /api/players/popular`
- `GET /api/quiz/:category/:difficulty?count=10`
- `POST /api/quiz/validate`
- `POST /api/ai/chat`
- `POST /api/ai/player-quiz`
