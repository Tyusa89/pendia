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
      family: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_demo: boolean
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_demo?: boolean
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_demo?: boolean
          name?: string
        }
        Relationships: []
      }
      handoff: {
        Row: {
          ate: boolean | null
          author_member_id: string | null
          created_at: string
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
          author_member_id?: string | null
          created_at?: string
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
          author_member_id?: string | null
          created_at?: string
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
          confirmed_by: string | null
          created_at: string
          family_id: string
          id: string
          medication: string
          source_timestamp: string | null
          speaker_label: string | null
          status: string
          visit_id: string | null
        }
        Insert: {
          after?: string | null
          before?: string | null
          confirmed_by?: string | null
          created_at?: string
          family_id: string
          id?: string
          medication: string
          source_timestamp?: string | null
          speaker_label?: string | null
          status?: string
          visit_id?: string | null
        }
        Update: {
          after?: string | null
          before?: string | null
          confirmed_by?: string | null
          created_at?: string
          family_id?: string
          id?: string
          medication?: string
          source_timestamp?: string | null
          speaker_label?: string | null
          status?: string
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
          created_at: string
          due_date: string | null
          family_id: string
          id: string
          owner_member_id: string | null
          source_timestamp: string | null
          source_visit_id: string | null
          status: string
          title: string
        }
        Insert: {
          created_at?: string
          due_date?: string | null
          family_id: string
          id?: string
          owner_member_id?: string | null
          source_timestamp?: string | null
          source_visit_id?: string | null
          status?: string
          title: string
        }
        Update: {
          created_at?: string
          due_date?: string | null
          family_id?: string
          id?: string
          owner_member_id?: string | null
          source_timestamp?: string | null
          source_visit_id?: string | null
          status?: string
          title?: string
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
          audio_url: string | null
          created_at: string
          date: string
          doctor: string
          family_id: string
          id: string
          summary: string | null
          transcript: Json
        }
        Insert: {
          audio_url?: string | null
          created_at?: string
          date: string
          doctor: string
          family_id: string
          id?: string
          summary?: string | null
          transcript?: Json
        }
        Update: {
          audio_url?: string | null
          created_at?: string
          date?: string
          doctor?: string
          family_id?: string
          id?: string
          summary?: string | null
          transcript?: Json
        }
        Relationships: [
          {
            foreignKeyName: "visit_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "family"
            referencedColumns: ["id"]
          },
        ]
      }
      watch_item: {
        Row: {
          created_at: string
          ends_on: string | null
          family_id: string
          id: string
          source_visit_id: string | null
          text: string
        }
        Insert: {
          created_at?: string
          ends_on?: string | null
          family_id: string
          id?: string
          source_visit_id?: string | null
          text: string
        }
        Update: {
          created_at?: string
          ends_on?: string | null
          family_id?: string
          id?: string
          source_visit_id?: string | null
          text?: string
        }
        Relationships: [
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
      is_family_member: { Args: { _family_id: string }; Returns: boolean }
      is_family_organizer: { Args: { _family_id: string }; Returns: boolean }
      join_demo_family: { Args: never; Returns: string }
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
