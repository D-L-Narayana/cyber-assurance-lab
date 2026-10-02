export type Protocol = 'dns' | 'http' | 'smtp';

export interface NormalizedEvent {
  id: string;
  line: number;
  ts: number;
  proto: Protocol;
  src: string;
  dst: string | null;
  summary: string;
  fields: Record<string, string | number>;
  raw: string;
}

export interface ParseError { line: number; reason: string; raw: string }

export interface ParseResult {
  events: NormalizedEvent[];
  errors: ParseError[];
  truncated: boolean;
  bytesRead: number;
  linesRead: number;
}

export type Severity = 'low' | 'medium' | 'high';

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  proto: Protocol;
  severity: Severity;
  src: string;
  dst: string | null;
  firstTs: number;
  lastTs: number;
  eventIds: string[];
  evidence: string[];
  explanation: string;
}

export interface Chain {
  id: string;
  src: string;
  protocols: Protocol[];
  alertIds: string[];
  firstTs: number;
  lastTs: number;
}
