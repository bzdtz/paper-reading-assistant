import { randomUUID } from 'node:crypto';

export interface StudyParagraphRef {
  id: string;
  sectionId: string;
  sectionTitle: string;
  sectionOrder: number;
  order: number;
  originalText: string;
}

export interface StudySession {
  id: string;
  paperId: string;
  createdAt: number;
  updatedAt: number;
  currentIndex: number;
  partParagraphCount: number;
  recentTurns: Array<{ role: 'user' | 'assistant'; content: string }>;
  memorySummary: string;
  paragraphs: StudyParagraphRef[];
}

export interface SessionProgress {
  currentPart: number;
  totalParts: number;
  currentSectionTitle: string;
  currentParagraphId: string;
  partParagraphCount: number;
}

const sessions = new Map<string, StudySession>();

const buildMemorySummary = (
  previousSummary: string,
  turns: Array<{ role: 'user' | 'assistant'; content: string }>
): string => {
  const recentAssistant = turns
    .filter((turn) => turn.role === 'assistant')
    .slice(-3)
    .map((turn) => turn.content.replace(/\s+/g, ' ').slice(0, 120));

  const merged = [previousSummary, ...recentAssistant]
    .filter(Boolean)
    .join(' | ')
    .slice(-1200);

  return merged;
};

const calcPartParagraphCount = (totalChars: number): number => {
  if (totalChars <= 20000) {
    return 1;
  }

  if (totalChars <= 80000) {
    return 2;
  }

  return 3;
};

const buildPartRanges = (session: StudySession): Array<{ start: number; end: number }> => {
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;

  while (cursor < session.paragraphs.length) {
    const start = cursor;
    const first = session.paragraphs[cursor];
    let end = cursor;

    while (
      end + 1 < session.paragraphs.length &&
      session.paragraphs[end + 1].sectionId === first.sectionId &&
      end - start + 1 < session.partParagraphCount
    ) {
      end += 1;
    }

    ranges.push({ start, end });
    cursor = end + 1;
  }

  return ranges;
};

const getPartRangeByIndex = (session: StudySession, partIndex: number): { start: number; end: number } => {
  const ranges = buildPartRanges(session);
  return ranges[Math.max(0, Math.min(partIndex, ranges.length - 1))] || { start: 0, end: 0 };
};

const getPartIndexByParagraphIndex = (session: StudySession, paragraphIndex: number): number => {
  const ranges = buildPartRanges(session);
  for (let i = 0; i < ranges.length; i += 1) {
    const range = ranges[i];
    if (paragraphIndex >= range.start && paragraphIndex <= range.end) {
      return i;
    }
  }
  return 0;
};

export const studySessionManager = {
  createSession(paperId: string, paragraphs: StudyParagraphRef[]): StudySession {
    const totalChars = paragraphs.reduce((sum, paragraph) => sum + paragraph.originalText.length, 0);
    const partParagraphCount = calcPartParagraphCount(totalChars);

    const session: StudySession = {
      id: randomUUID(),
      paperId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      currentIndex: 0,
      partParagraphCount,
      recentTurns: [],
      memorySummary: '',
      paragraphs
    };

    sessions.set(session.id, session);
    return session;
  },

  getSession(sessionId: string): StudySession | null {
    return sessions.get(sessionId) || null;
  },

  appendTurn(sessionId: string, role: 'user' | 'assistant', content: string): void {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.recentTurns.push({ role, content });
    session.recentTurns = session.recentTurns.slice(-10);
    session.memorySummary = buildMemorySummary(session.memorySummary, session.recentTurns);
    session.updatedAt = Date.now();
  },

  getCurrentPart(session: StudySession): {
    partText: string;
    sectionTitle: string;
    paragraphIds: string[];
    currentParagraphId: string;
    currentPart: number;
    totalParts: number;
  } {
    const partIndex = getPartIndexByParagraphIndex(session, session.currentIndex);
    const range = getPartRangeByIndex(session, partIndex);
    const partParagraphs = session.paragraphs.slice(range.start, range.end + 1);

    return {
      partText: partParagraphs.map((item) => item.originalText).join('\n\n'),
      sectionTitle: partParagraphs[0]?.sectionTitle || '未知章节',
      paragraphIds: partParagraphs.map((item) => item.id),
      currentParagraphId: partParagraphs[0]?.id || '',
      currentPart: partIndex + 1,
      totalParts: buildPartRanges(session).length
    };
  },

  moveToNextPart(session: StudySession): boolean {
    const partIndex = getPartIndexByParagraphIndex(session, session.currentIndex);
    const ranges = buildPartRanges(session);

    if (partIndex >= ranges.length - 1) {
      return false;
    }

    session.currentIndex = ranges[partIndex + 1].start;
    session.updatedAt = Date.now();
    return true;
  },

  moveToNextSection(session: StudySession): boolean {
    const currentParagraph = session.paragraphs[session.currentIndex];
    if (!currentParagraph) {
      return false;
    }

    const targetIndex = session.paragraphs.findIndex(
      (paragraph) => paragraph.sectionOrder > currentParagraph.sectionOrder
    );

    if (targetIndex < 0) {
      return false;
    }

    session.currentIndex = targetIndex;
    session.updatedAt = Date.now();
    return true;
  },

  getProgress(session: StudySession): SessionProgress {
    const current = this.getCurrentPart(session);
    return {
      currentPart: current.currentPart,
      totalParts: current.totalParts,
      currentSectionTitle: current.sectionTitle,
      currentParagraphId: current.currentParagraphId,
      partParagraphCount: session.partParagraphCount
    };
  }
};
