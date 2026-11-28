export type BlueprintStatus = 'exploring' | 'defining' | 'planning' | 'executing' | 'paused' | 'archived';
export type Persona = {
  id: string;
  name: string;
  side: 'internal' | 'external';
  relations: ('decision_maker' | 'user' | 'affected' | 'payer')[];
  profile: string;
  frequency: string;
  wikiId?: string;
};
export type Scenario = { id: string; personaId?: string; when: string; task: string; outcome: string };
export type Pain = {
  id: string;
  personaId?: string;
  scenarioId?: string;
  text: string;
  kind: 'fact' | 'inference' | 'question';
  severity: 'high' | 'medium' | 'low';
  evidence?: { rawId: string; quote?: string };
  evidenceRedacted?: boolean;
};
export type Alternative = { id: string; personaId?: string; currentApproach: string; cost: string };
export type Value = {
  id: string;
  personaIds: string[];
  painIds: string[];
  advantage: string;
  confidence: 'verified' | 'assumed';
  validation: string;
};
export type Feature = {
  id: string;
  title: string;
  description: string;
  valueIds: string[];
  priority: 'must' | 'should' | 'could' | 'wont';
  phase: 'mvp' | 'v1' | 'later';
  wontReason: string;
};
export type Metric = { id: string; name: string; definition: string; target: string };
export type Risk = { id: string; text: string };
export type Milestone = { id: string; title: string; targetWeek: string; featureIds: string[]; deliverable: string };
export type Blueprint = {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  title: string;
  oneLiner: string;
  status: BlueprintStatus;
  context: { background: string; businessGoal: string; constraints: string };
  links: { rawIds: string[]; wikiIds: string[]; workItemIds: string[] };
  personas: Persona[];
  scenarios: Scenario[];
  pains: Pain[];
  alternatives: Alternative[];
  values: Value[];
  features: Feature[];
  vision: { northStar: string; targetScope: string; outOfScope: string; metrics: Metric[]; risks: Risk[] };
  milestones: Milestone[];
};
export type BlueprintCheck = {
  code: 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7';
  collection: string;
  id: string;
  message: string;
};
export type SourceDisplay = { id: string; title?: string; available: boolean };
export type BlueprintDetail = {
  blueprint: Blueprint;
  checks: BlueprintCheck[];
  sources: { raw: SourceDisplay[]; wiki: SourceDisplay[]; workItems: SourceDisplay[] };
};
