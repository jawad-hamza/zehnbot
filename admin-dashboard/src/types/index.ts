export interface Client {
  id: string;
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
  ai_provider: string;
  ai_model: string | null;
  ai_api_key: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClientListItem {
  id: string;
  name: string;
  domain: string;
  client_id: string;
  bot_name: string;
  is_active: boolean;
  created_at: string;
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
  created_at: string;
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
  captured_at: string;
}
