-- CreateTable
CREATE TABLE "QuizSet" (
    "id" TEXT NOT NULL,
    "targetLanguage" TEXT NOT NULL,
    "knownLanguage" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "QuizSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quiz" (
    "id" TEXT NOT NULL,
    "quizSetId" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "sentenceTarget" TEXT NOT NULL,
    "sentenceKnownMasked" TEXT NOT NULL,
    "optionsKnown" JSONB NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "indexInSet" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "difficultyScore" INTEGER NOT NULL,
    "difficultyLabel" TEXT NOT NULL,
    "difficultyReason" TEXT NOT NULL,

    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAnswer" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "attemptToken" TEXT NOT NULL,
    "choiceIndex" INTEGER,
    "isCorrect" BOOLEAN,
    "action" TEXT NOT NULL,
    "timeMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizEvent" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quiz_slug_key" ON "Quiz"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "QuizAnswer_quizId_attemptToken_key" ON "QuizAnswer"("quizId", "attemptToken");

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_quizSetId_fkey" FOREIGN KEY ("quizSetId") REFERENCES "QuizSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAnswer" ADD CONSTRAINT "QuizAnswer_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizEvent" ADD CONSTRAINT "QuizEvent_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
