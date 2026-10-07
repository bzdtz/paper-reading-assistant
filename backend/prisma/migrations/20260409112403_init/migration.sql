-- CreateTable
CREATE TABLE "AnalysisRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sourceType" TEXT NOT NULL,
    "fileName" TEXT,
    "contentChars" INTEGER NOT NULL,
    "extractedChars" INTEGER,
    "sectionsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
