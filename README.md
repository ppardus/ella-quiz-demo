# Ella Quiz Demo

An end-to-end demo app that generates vocabulary quizzes using LLMs.  
It includes:

- `backend/` → Express + Prisma + OpenAI/Anthropic
- `frontend/` → React + Vite + Tailwind

---

## 🚀 Quick Start

### Requirements
- Node.js **22+** (recommended for Vite 7)
- pnpm (`corepack enable`)
- OpenAI API key (or Anthropic if preferred)

---

### Clone & Setup

```bash
git clone <your-repo-url> ella-quiz-demo
cd ella-quiz-demo

# Node version
nvm install --lts=iron
nvm use 22

corepack enable
pnpm i
```

### Backend Setup

```bash
cd backend
cp .env.example .env
# fill in your API key

pnpm i
pnpm prisma generate
pnpm prisma migrate dev --name init
pnpm dev
# → http://localhost:3000/health  => {"ok":true}
```

.env.example
```bash
DATABASE_URL="file:./dev.db"
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY=""
PREFERRED_LLM="openai"
PORT=3000
CORS_ALLOW_ORIGIN=http://localhost:5173
```

### Frontend Setup

```bash
cd ../frontend
cp .env.example .env
pnpm i
pnpm dev
# → http://localhost:5173
```

.env.example
```bash
VITE_API_BASE=http://localhost:3000
```

### Run Both Together (root)

```bash
cd ..
pnpm dev
```