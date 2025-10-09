-- CreateTable
CREATE TABLE "QuizSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetLanguage" TEXT NOT NULL,
    "knownLanguage" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB
);

-- CreateTable
CREATE TABLE "Quiz" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quizSetId" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "sentenceTarget" TEXT NOT NULL,
    "sentenceKnownMasked" TEXT NOT NULL,
    "optionsKnown" JSONB NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "indexInSet" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Quiz_quizSetId_fkey" FOREIGN KEY ("quizSetId") REFERENCES "QuizSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuizAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quizId" TEXT NOT NULL,
    "choiceIndex" INTEGER,
    "isCorrect" BOOLEAN,
    "action" TEXT NOT NULL,
    "timeMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuizAnswer_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Quiz_slug_key" ON "Quiz"("slug");
