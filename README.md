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

### Endpoints

#### POST /api/quizzes/generate

Creates a new quiz set, generates one MCQ per input word using the configured LLM, and persists it.

```bash
curl -X POST "$BASE/api/quizzes/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "target_language":"German",
    "known_language":"English",
    "level":"A2",
    "raw_text":"Entscheidung: decision\nEinladung/ invitation\nFrage;question\nGespräch -> conversation\nBuongiorno",
    "options": { "num_options": 4, "shuffle": true }
  }'
```

#### GET /api/quizzes/:quiz_id

Get a single quiz

```bash
curl "$BASE/api/quizzes/<quiz_id>"
```

#### POST /api/quizzes/:quiz_id/answer

Records the learner’s answer, correctness, and time-to-answer.
Use "skipped" to record a skip without a choice.

```bash
Body:
{
  "choice_index": 2,
  "time_ms": 4500,
  "action": "answered"
}

curl -X POST "$BASE/api/quizzes/<quiz_id>/answer" \
  -H "Content-Type: application/json" \
  -d '{ "choice_index": 2, "time_ms": 4500, "action": "answered" }'
```

#### POST /api/quizzes/:quiz_id/next-click

Records when the user pressed Next (useful for funnel/latency analytics).

```bash
Body:
{
  "from_index": 1
}

curl -X POST "$BASE/api/quizzes/<quiz_id>/next-click" \
  -H "Content-Type: application/json" \
  -d '{ "from_index": 1 }'
```

#### GET /api/quiz-sets/:id/quizzes

List quizzes in a set

```bash
curl "$BASE/api/quiz-sets/<quiz_set_id>/quizzes"
```

#### GET /api/quiz-sets/:id/summary

Returns overall accuracy, counts, per-quiz results (with answered_at), and UX events including next_click timestamps.

```bash
curl "$BASE/api/quiz-sets/<quiz_set_id>/summary"
```

### Example End-to-End

```bash
BASE="http://localhost:3000"

# 1) Generate
GEN=$(curl -s -X POST "$BASE/api/quizzes/generate" -H "Content-Type: application/json" -d '{
  "target_language":"German",
  "known_language":"English",
  "level":"A2",
  "raw_text":"Entscheidung: decision\nEinladung/ invitation\nFrage;question\nGespräch -> conversation"
}')
SET=$(echo "$GEN" | jq -r .quiz_set_id)
FIRST=$(echo "$GEN" | jq -r .items[0].quiz_id)

# 2) Fetch quiz
curl -s "$BASE/api/quizzes/$FIRST" | jq

# 3) Answer
curl -s -X POST "$BASE/api/quizzes/$FIRST/answer" \
  -H "Content-Type: application/json" \
  -d '{"choice_index":0,"time_ms":3200,"action":"answered"}' | jq

# 4) Next click
curl -s -X POST "$BASE/api/quizzes/$FIRST/next-click" \
  -H "Content-Type: application/json" \
  -d '{"from_index":1}' | jq

# 5) Results
curl -s "$BASE/api/quiz-sets/$SET/summary" | jq
```