export interface Client {
  id: string;
  tenant_id: string;
  name: string;
  domain: string;
  client_id: string;
  bot_name: string;
  system_prompt: string;
  welcome_message: string;
  theme_color: string;
  widget_position: string;
  font_family: string | null;
  custom_css: string | null;
  custom_js: string | null;
  /** slot ("normal" | "hover" | "open") -> picture URL, for the ones that are set */
  launcher_images: Partial<Record<LauncherSlot, string>>;
  /** Soft chirp in the widget when the bot replies (visitors can mute it themselves). */
  notification_sound: boolean;
  ai_provider: string;
  ai_model: string | null;
  /** Only for the "custom" provider: any OpenAI-compatible endpoint. */
  ai_base_url: string | null;
  /** The key itself never leaves the server; these two describe it. */
  ai_api_key_set: boolean;
  ai_api_key_hint: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** What the bot form submits. `ai_api_key`: undefined = keep, "" = remove, text = replace. */
export type ClientPayload = Partial<Omit<Client, "ai_api_key_set" | "ai_api_key_hint">> & {
  ai_api_key?: string;
  /** New bots only: read the website and take its brand colour and font for the widget. */
  match_website?: boolean;
};

/** One entry of the backend's provider catalogue (GET /admin/providers). */
export interface AiProvider {
  id: string;
  label: string;
  default_model: string | null;
  model_hint: string;
  keys_url: string;
  needs_base_url: boolean;
}

export interface ClientListItem {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  name: string;
  domain: string;
  client_id: string;
  bot_name: string;
  is_active: boolean;
  created_at: string;
}

export interface TenantSummary {
  id: string;
  name: string;
  plan: string;
  monthly_message_quota: number;
  max_bots: number;
  bots_used: number;
  messages_this_month: number;
  platform_messages_this_month: number;
}

export interface Me {
  id: string;
  email: string;
  role: "superadmin" | "tenant_admin";
  tenant: TenantSummary | null;
  has_password: boolean;
  google_linked: boolean;
}

export interface TenantUser {
  id: string;
  email: string;
  is_active: boolean;
  created_at: string;
}

export interface Tenant {
  id: string;
  name: string;
  plan: string;
  monthly_message_quota: number;
  max_bots: number;
  is_active: boolean;
  created_at: string;
  bots_used: number;
  messages_this_month: number;
  platform_messages_this_month: number;
  tokens_this_month: number;
  users: TenantUser[];
}

export interface Plan {
  name: string;
  monthly_message_quota: number;
  max_bots: number;
}

export interface IngestJob {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  url: string;
  pages_crawled: number;
  chunks_created: number;
  error: string | null;
}

export interface KnowledgeChunk {
  id: string;
  chunk_text: string;
  chunk_index: number;
  source_label: string;
  created_at: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  tokens_used: number | null;
  /** The bot said it could not answer the question before this reply. */
  unanswered: boolean;
  created_at: string;
}

export interface DailyActivity {
  date: string;
  conversations: number;
  visitor_messages: number;
  leads: number;
}

export interface Analytics {
  days: number;
  conversations: number;
  visitor_messages: number;
  leads: number;
  unanswered: number;
  lead_conversion_rate: number;
  answer_rate: number;
  daily: DailyActivity[];
  unanswered_questions: { question: string; asked_at: string; conversation_id: string }[];
}

export interface Conversation {
  id: string;
  session_id: string;
  started_at: string;
  last_message_at: string;
  message_count: number;
}

export interface Lead {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  /** "form" = the widget's contact form, "chat" = typed into the conversation */
  source: "form" | "chat";
  conversation_id: string | null;
  captured_at: string;
}

export type LauncherSlot = "normal" | "hover" | "open";
