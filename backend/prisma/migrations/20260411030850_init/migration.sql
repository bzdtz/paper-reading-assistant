-- CreateTable
CREATE TABLE "Paper" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "mineruTaskId" TEXT,
    "rawContent" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paperId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "Section_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Paragraph" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectionId" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "Paragraph_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Translation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paragraphId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    CONSTRAINT "Translation_paragraphId_fkey" FOREIGN KEY ("paragraphId") REFERENCES "Paragraph" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Explanation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paragraphId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    CONSTRAINT "Explanation_paragraphId_fkey" FOREIGN KEY ("paragraphId") REFERENCES "Paragraph" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FollowUpQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parentId" TEXT NOT NULL,
    "parentType" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "translationId" TEXT,
    "explanationId" TEXT,
    CONSTRAINT "FollowUpQuestion_translationId_fkey" FOREIGN KEY ("translationId") REFERENCES "Translation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FollowUpQuestion_explanationId_fkey" FOREIGN KEY ("explanationId") REFERENCES "Explanation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Section_paperId_idx" ON "Section"("paperId");

-- CreateIndex
CREATE INDEX "Paragraph_sectionId_idx" ON "Paragraph"("sectionId");

-- CreateIndex
CREATE INDEX "Translation_paragraphId_idx" ON "Translation"("paragraphId");

-- CreateIndex
CREATE INDEX "Explanation_paragraphId_idx" ON "Explanation"("paragraphId");

-- CreateIndex
CREATE INDEX "FollowUpQuestion_parentId_idx" ON "FollowUpQuestion"("parentId");
