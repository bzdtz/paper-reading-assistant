export interface PaperSection {
  title: string;
  content: string;
  explanation: string;
}

export interface AnalyzePaperResponse {
  sections: PaperSection[];
}

export interface UploadPaperResponse extends AnalyzePaperResponse {
  fileName: string;
  extractedChars: number;
}

export type AnalyzeSourceType = "TEXT" | "FILE";
