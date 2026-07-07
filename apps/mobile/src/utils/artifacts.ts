export type ConversationArtifactKind = 'cron_trigger' | 'skill_suggest';
export type ConversationArtifactStatus = 'active' | 'pending' | 'dismissed' | 'saved';
export type ConversationArtifactPayload = Record<string, unknown> | string;

export type ConversationArtifactBase<
  Kind extends ConversationArtifactKind = ConversationArtifactKind,
  Payload extends ConversationArtifactPayload = ConversationArtifactPayload,
> = {
  id: string;
  conversation_id: string;
  cron_job_id?: string;
  kind: Kind;
  status: ConversationArtifactStatus;
  payload: Payload;
  created_at: number;
  updated_at: number;
};

export type CronTriggerArtifact = ConversationArtifactBase<
  'cron_trigger',
  {
    cron_job_id: string;
    cron_job_name: string;
    triggered_at: number;
  }
>;

export type SkillSuggestArtifact = ConversationArtifactBase<
  'skill_suggest',
  {
    cron_job_id: string;
    name: string;
    description: string;
    skillContent?: string;
    skill_content?: string;
  }
>;

export type ConversationArtifact = CronTriggerArtifact | SkillSuggestArtifact | ConversationArtifactBase;

export function normalizeConversationArtifact(value: unknown): ConversationArtifact | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.conversation_id !== 'string' || value.conversation_id.length === 0) return null;
  if (!isArtifactKind(value.kind)) return null;
  if (!isArtifactStatus(value.status)) return null;

  return {
    id: value.id,
    conversation_id: value.conversation_id,
    ...(typeof value.cron_job_id === 'string' ? { cron_job_id: value.cron_job_id } : {}),
    kind: value.kind,
    status: value.status,
    payload: isRecord(value.payload) || typeof value.payload === 'string' ? value.payload : {},
    created_at: numberValue(value.created_at),
    updated_at: numberValue(value.updated_at),
  };
}

export function normalizeConversationArtifacts(value: unknown): ConversationArtifact[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeConversationArtifact).filter((artifact): artifact is ConversationArtifact => artifact !== null);
}

export function upsertConversationArtifacts(
  current: ConversationArtifact[],
  next: ConversationArtifact | ConversationArtifact[],
): ConversationArtifact[] {
  const incoming = Array.isArray(next) ? next : [next];
  if (incoming.length === 0) return current;

  const byId = new Map(current.map((artifact) => [artifact.id, artifact]));
  for (const artifact of incoming) {
    byId.set(artifact.id, artifact);
  }
  return [...byId.values()].sort((a, b) => a.created_at - b.created_at);
}

export function isVisibleConversationArtifact(artifact: ConversationArtifact): boolean {
  if (artifact.kind === 'cron_trigger') return artifact.status === 'active';
  if (artifact.kind === 'skill_suggest') return artifact.status === 'pending';
  return false;
}

export function artifactPayloadRecord(artifact: ConversationArtifact): Record<string, unknown> {
  if (isRecord(artifact.payload)) return artifact.payload;
  try {
    const parsed = JSON.parse(artifact.payload);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function isArtifactStatus(value: unknown): value is ConversationArtifactStatus {
  return value === 'active' || value === 'pending' || value === 'dismissed' || value === 'saved';
}

function isArtifactKind(value: unknown): value is ConversationArtifactKind {
  return value === 'cron_trigger' || value === 'skill_suggest';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
