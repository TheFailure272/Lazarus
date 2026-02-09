export enum DiagnosisStatus {
  NORMAL = 'NORMAL',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL'
}

export interface MedicalAlert {
  status: DiagnosisStatus;
  diagnosis: string;
  confidence: number;
  symptoms: string[];
  cpr_feedback?: string; // e.g., "PUSH FASTER", "GOOD DEPTH"
  timestamp: number;
}

export interface StreamConfig {
  video: boolean;
  audio: boolean;
  fps: number;
}
