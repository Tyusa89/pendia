export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      care_recipient: {
        Row: {
          created_at: string
          family_id: string
          id: string
          name: string
          notes: string | null
        }
        Insert: {
          created_at?: string
          family_id: string
          id?: string
          name: string
          notes?: string | null
        }
        Update: {
          created_at?: string
          family_id?: string
          id?: string
          name?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "care_recipient_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "family"
            referencedColumns: ["id"]
          },
        ]
      }
      digest: {
        Row: {
          created_at: string
          family_id: string
          id: string
          language: string
          member_id: string | null
          sent_at: string | null
          text: string
          week: string
        }
        Insert: {
          created_at?: string
          family_id: string
          id?: string
          language?: string
          member_id?: string | null
          sent_at?: string | null
          text: string
          week: string
        }
        Update: {
          created_at?: string
          family_id?: string
          id?: string
          language?: string
          member_id?: string | null
          sent_at?: string | null
          text?: string
          week?: string
        }
        Relationships: [
          {
            foreignKeyName: "digest_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "family"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "digest_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member"
            referencedColumns: ["id"]
          },
        ]
      }
      dose_administration: {
        Row: {
          change_reason: string | null
          client_request_id: string
          disputes: string | null
          dose_text: string | null
          entry_kind: string
          family_id: string
          id: string
          local_date: string
          medication_name: string
          not_given_reason: string | null
          outside_window: boolean
          reported_at: string
          reported_by: string
          reported_via: string
          reporter_name: string
          schedule_id: string
          scheduled_at: string
          seq: number
          status: string | null
          supersedes: string | null
          tz: string
        }
        Insert: {
          change_reason?: string | null
          client_request_id: string
          disputes?: string | null
          dose_text?: string | null
          entry_kind?: string
          family_id: string
          id?: string
          local_date: string
          medication_name: string
          not_given_reason?: string | null
          outside_window?: boolean
          reported_at?: string
          reported_by: string
          reported_via?: string
          reporter_name: string
          schedule_id: string
          scheduled_at: string
          seq?: never
          status?: string | null
          supersedes?: string | null
          tz: string
        }
        Update: {
          change_reason?: string | null
          client_request_id?: string
          disputes?: string | null
          dose_text?: string | null
          entry_kind?: string
          family_id?: string
          id?: string
          local_date?: string
          medication_name?: string
          not_given_reason?: string | null
          outside_window?: boolean
          reported_at?: string
          reported_by?: string
          reported_via?: string
          reporter_name?: string
          schedule_id?: string
          scheduled_at?: string
          seq?: never
          status?: string | null
          supersedes?: string | null
          tz?: string
        }
        Relationships: [
          {
            foreignKeyName: "dose_administration_disputes_fkey"
            columns: ["disputes"]
            isOneToOne: false
            referencedRelation: "dose_administration"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dose_administration_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "family"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dose_administration_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "medication_schedule"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dose_administration_supersedes_fkey"
            columns: ["supersedes"]
            isOneToOne: false
            referencedRelation: "dose_administration"
            referencedColumns: ["id"]
          },
        ]
      }
      family: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_demo: boolean
          name: string
          timezone: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_demo?: boolean
          name: string
          timezone?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_demo?: boolean
          name?: string
          timezone?: string
        }
        Relationships: []
      }
      handoff: {
        Row: {
          ate: boolean | null
          audio_mime: string | null
          audio_path: string | null
          audio_size_bytes: number | null
          audio_wav_mime: string | null
          audio_wav_path: string | null
          audio_wav_size_bytes: number | null
          author_member_id: string | null
          created_at: string
          duration_seconds: number | null
          family_id: string
          id: string
          meds_taken: boolean | null
          note: string | null
          shift_id: string | null
          unusual: string | null
          watch_answers: Json
        }
        Insert: {
          ate?: boolean | null
          audio_mime?: string | null
          audio_path?: string | null
          audio_size_bytes?: number | null
          audio_wav_mime?: string | null
          audio_wav_path?: string | null
          audio_wav_size_bytes?: number | null
          author_member_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          family_id: string
          id?: string
          meds_taken?: boolean | null
          note?: string | null
          shift_id?: string | null
          unusual?: string | null
          watch_answers?: Json
        }
        Update: {
          ate?: boolean | null
          audio_mime?: string | null
          audio_path?: string | null
          audio_size_bytes?: number | null
          audio_wav_mime?: string | null
          audio_wav_path?: string | null
          audio_wav_size_bytes?: number | null
          author_member_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          family_id?: string
          id?: string
          meds_taken?: boolean | null
          note?: string | null
          shift_id?: string | null
          unusual?: string | null
          watch_answers?: Json
        }
        Relationships: [
          {
            foreignKeyName: "handoff_author_member_id_fkey"
            columns: ["author_member_id"]
            isOneToOne: false
            referencedRelation: "member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handoff_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "family"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handoff_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shift"
            referencedColumns: ["id"]
          },
        ]
      }
      med_change: {
        Row: {
          after: string | null
          before: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          family_id: string
          id: string
          medication: string
          source_seconds: number | null
          speaker_label: string | null
          status: string
          unclear: boolean
          visit_id: string | null
        }
        Insert: {
          after?: string | null
          before?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          family_id: string
          id?: string
          medication: string
          source_seconds?: number | null
          speaker_label?: string | null
          status?: string
          unclear?: boolean
          visit_id?: string | null
        }
        Update: {
          after?: string | null
          before?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          family_id?: string
          id?: string
          medication?: string
          source_seconds?: number | null
          speaker_label?: string | null
          status?: string
          unclear?: boolean
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "med_change_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "med_change_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "family"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "med_change_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visit"
            referencedColumns: ["id"]
          },
        ]
      }
      medication: {
        Row: {
          created_at: string
          dose: string | null
          family_id: string
          id: string
          name: string
          schedule: string | null
          status: string
        }
        Insert: {
          created_at?: string
          dose?: string | null
          family_id: string
          id?: string
          name: string
          schedule?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          dose?: string | null
          family_id?: string
          id?: string
          name?: string
          schedule?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "medication_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "family"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_schedule: {
        Row: {
          created_at: string
          created_by: string | null
          days_of_week: number[]
          ends_on: string | null
          family_id: string
          id: string
          local_time: string
          medication_id: string
          starts_on: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          days_of_week: number[]
          ends_on?: string | null
          family_id: string
          id?: string
          local_time: string
          medication_id: string
          starts_on: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          days_of_week?: number[]
          ends_on?: string | null
          family_id?: string
          id?: string
          local_time?: string
          medication_id?: string
          starts_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "medication_schedule_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "family"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_schedule_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "medication"
            referencedColumns: ["id"]
          },
        ]
      }
      member: {
        Row: {
          can_see_meds: boolean
          can_see_schedule: boolean
          can_see_visits: boolean
          created_at: string
          family_id: string
          id: string
          language: string
          name: string
          phone: string | null
          role: string
          user_id: string | null
        }
        Insert: {
          can_see_meds?: boolean
          can_see_schedule?: boolean
          can_see_visits?: boolean
          created_at?: string
          family_id: string
          id?: string
          language?: string
          name: string
          phone?: string | null
          role?: string
          user_id?: string | null
        }
        Update: {
          can_see_meds?: boolean
          can_see_schedule?: boolean
          can_see_visits?: boolean
          created_at?: string
          family_id?: string
          id?: string
          language?: string
          name?: string
          phone?: string | null
          role?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "family"
            referencedColumns: ["id"]
          },
        ]
      }
      shift: {
        Row: {
          assigned_member_id: string | null
          created_at: string
          end: string
          family_id: string
          id: string
          start: string
          status: string
        }
        Insert: {
          assigned_member_id?: string | null
          created_at?: string
          end: string
          family_id: string
          id?: string
          start: string
          status?: string
        }
        Update: {
          assigned_member_id?: string | null
          created_at?: string
          end?: string
          family_id?: string
          id?: string
          start?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_assigned_member_id_fkey"
            columns: ["assigned_member_id"]
            isOneToOne: false
            referencedRelation: "member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "family"
            referencedColumns: ["id"]
          },
        ]
      }
      task: {
        Row: {
          completed_at: string | null
          created_at: string
          due_date: string | null
          family_id: string
          id: string
          owner_member_id: string | null
          source_seconds: number | null
          source_visit_id: string | null
          speaker_label: string | null
          status: string
          title: string
          unclear: boolean
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          family_id: string
          id?: string
          owner_member_id?: string | null
          source_seconds?: number | null
          source_visit_id?: string | null
          speaker_label?: string | null
          status?: string
          title: string
          unclear?: boolean
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          family_id?: string
          id?: string
          owner_member_id?: string | null
          source_seconds?: number | null
          source_visit_id?: string | null
          speaker_label?: string | null
          status?: string
          title?: string
          unclear?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "task_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "family"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_source_visit_id_fkey"
            columns: ["source_visit_id"]
            isOneToOne: false
            referencedRelation: "visit"
            referencedColumns: ["id"]
          },
        ]
      }
      visit: {
        Row: {
          archived_at: string | null
          audio_path: string | null
          audio_url: string | null
          confirmation_status: string
          consent_at: string | null
          consent_by: string | null
          consent_text: string | null
          created_at: string
          date: string
          doctor: string | null
          duration_seconds: number | null
          family_id: string
          id: string
          notes: string | null
          office_address: string | null
          office_name: string | null
          office_phone: string | null
          provider_name: string | null
          reason: string | null
          reminder_prefs: Json
          scheduled_end: string | null
          scheduled_start: string | null
          speaker_map: Json
          speaker_map_confirmed_at: string | null
          speaker_map_confirmed_by: string | null
          status: string
          summary: string | null
          transcript: Json
        }
        Insert: {
          archived_at?: string | null
          audio_path?: string | null
          audio_url?: string | null
          confirmation_status?: string
          consent_at?: string | null
          consent_by?: string | null
          consent_text?: string | null
          created_at?: string
          date: string
          doctor?: string | null
          duration_seconds?: number | null
          family_id: string
          id?: string
          notes?: string | null
          office_address?: string | null
          office_name?: string | null
          office_phone?: string | null
          provider_name?: string | null
          reason?: string | null
          reminder_prefs?: Json
          scheduled_end?: string | null
          scheduled_start?: string | null
          speaker_map?: Json
          speaker_map_confirmed_at?: string | null
          speaker_map_confirmed_by?: string | null
          status?: string
          summary?: string | null
          transcript?: Json
        }
        Update: {
          archived_at?: string | null
          audio_path?: string | null
          audio_url?: string | null
          confirmation_status?: string
          consent_at?: string | null
          consent_by?: string | null
          consent_text?: string | null
          created_at?: string
          date?: string
          doctor?: string | null
          duration_seconds?: number | null
          family_id?: string
          id?: string
          notes?: string | null
          office_address?: string | null
          office_name?: string | null
          office_phone?: string | null
          provider_name?: string | null
          reason?: string | null
          reminder_prefs?: Json
          scheduled_end?: string | null
          scheduled_start?: string | null
          speaker_map?: Json
          speaker_map_confirmed_at?: string | null
          speaker_map_confirmed_by?: string | null
          status?: string
          summary?: string | null
          transcript?: Json
        }
        Relationships: [
          {
            foreignKeyName: "visit_consent_by_fkey"
            columns: ["consent_by"]
            isOneToOne: false
            referencedRelation: "member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "family"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_speaker_map_confirmed_by_fkey"
            columns: ["speaker_map_confirmed_by"]
            isOneToOne: false
            referencedRelation: "member"
            referencedColumns: ["id"]
          },
        ]
      }
      watch_item: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          ends_on: string | null
          family_id: string
          id: string
          source_seconds: number | null
          source_visit_id: string | null
          speaker_label: string | null
          status: string
          text: string
          unclear: boolean
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          ends_on?: string | null
          family_id: string
          id?: string
          source_seconds?: number | null
          source_visit_id?: string | null
          speaker_label?: string | null
          status?: string
          text: string
          unclear?: boolean
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          ends_on?: string | null
          family_id?: string
          id?: string
          source_seconds?: number | null
          source_visit_id?: string | null
          speaker_label?: string | null
          status?: string
          text?: string
          unclear?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "watch_item_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "watch_item_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "family"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "watch_item_source_visit_id_fkey"
            columns: ["source_visit_id"]
            isOneToOne: false
            referencedRelation: "visit"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      dose_occurrences: {
        Args: { _family_id: string; _from: string; _to: string }
        Returns: {
          change_reason: string
          dose_text: string
          head_id: string
          history_count: number
          local_date: string
          local_time: string
          medication_id: string
          medication_name: string
          not_given_reason: string
          open_disagreements: number
          outside_window: boolean
          reported_at: string
          reported_by: string
          reported_by_name: string
          reports_differ: boolean
          schedule_id: string
          scheduled_at: string
          status: string
          time_state: string
          tz: string
        }[]
      }
      dose_scheduled_at: {
        Args: { _date: string; _time: string; _tz: string }
        Returns: Record<string, unknown>
      }
      flag_dose_disagreement: {
        Args: {
          _client_request_id: string
          _expected_head: string
          _local_date: string
          _schedule_id: string
        }
        Returns: {
          change_reason: string | null
          client_request_id: string
          disputes: string | null
          dose_text: string | null
          entry_kind: string
          family_id: string
          id: string
          local_date: string
          medication_name: string
          not_given_reason: string | null
          outside_window: boolean
          reported_at: string
          reported_by: string
          reported_via: string
          reporter_name: string
          schedule_id: string
          scheduled_at: string
          seq: number
          status: string | null
          supersedes: string | null
          tz: string
        }
        SetofOptions: {
          from: "*"
          to: "dose_administration"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_family_member: { Args: { _family_id: string }; Returns: boolean }
      is_family_organizer: { Args: { _family_id: string }; Returns: boolean }
      join_demo_family: { Args: never; Returns: string }
      member_can_see: {
        Args: { _family_id: string; _what: string }
        Returns: boolean
      }
      recording_can_read: { Args: { p: string }; Returns: boolean }
      recording_can_write: { Args: { p: string }; Returns: boolean }
      recording_path_family: { Args: { p: string }; Returns: string }
      recording_path_type: { Args: { p: string }; Returns: string }
      report_dose: {
        Args: {
          _change_reason?: string
          _client_request_id: string
          _expected_head: string
          _local_date: string
          _not_given_reason?: string
          _schedule_id: string
          _status: string
        }
        Returns: {
          change_reason: string | null
          client_request_id: string
          disputes: string | null
          dose_text: string | null
          entry_kind: string
          family_id: string
          id: string
          local_date: string
          medication_name: string
          not_given_reason: string | null
          outside_window: boolean
          reported_at: string
          reported_by: string
          reported_via: string
          reporter_name: string
          schedule_id: string
          scheduled_at: string
          seq: number
          status: string | null
          supersedes: string | null
          tz: string
        }
        SetofOptions: {
          from: "*"
          to: "dose_administration"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      valid_iso_days: { Args: { _d: number[] }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
