/**
 * Generated from the live schema — do not edit by hand.
 *
 *   supabase gen types typescript --project-id qhovmmsunhowfkcdszkj
 *
 * The convenience generics the generator also emits (`Tables<>`, `Enums<>`…)
 * are dropped; nothing here uses them. `types.ts` is where these rows are given
 * the core's own unions.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  __InternalSupabase: { PostgrestVersion: '14.5' }
  public: {
    Tables: {
      audit_events: {
        Row: {
          actor: string
          at: string
          domain_id: string | null
          domain_name: string
          evidence: Json | null
          from_status: string | null
          id: number
          kind: string
          level: string | null
          owner_id: string
          to_status: string | null
        }
        Insert: {
          actor: string
          at: string
          domain_id?: string | null
          domain_name: string
          evidence?: Json | null
          from_status?: string | null
          id?: never
          kind: string
          level?: string | null
          owner_id: string
          to_status?: string | null
        }
        Update: {
          actor?: string
          at?: string
          domain_id?: string | null
          domain_name?: string
          evidence?: Json | null
          from_status?: string | null
          id?: never
          kind?: string
          level?: string | null
          owner_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'audit_events_domain_id_fkey'
            columns: ['domain_id']
            isOneToOne: false
            referencedRelation: 'domains'
            referencedColumns: ['id']
          },
        ]
      }
      domains: {
        Row: {
          created_at: string
          hidden_at: string | null
          id: string
          is_sandbox: boolean
          last_changed_at: string
          last_checked_at: string | null
          name: string
          next_check_at: string | null
          owner_id: string
          ownership: Json
          record: Json
          supersession: Json | null
          version: number
        }
        Insert: {
          created_at?: string
          hidden_at?: string | null
          id?: string
          is_sandbox?: boolean
          last_changed_at?: string
          last_checked_at?: string | null
          name: string
          next_check_at?: string | null
          owner_id: string
          ownership: Json
          record?: Json
          supersession?: Json | null
          version?: number
        }
        Update: {
          created_at?: string
          hidden_at?: string | null
          id?: string
          is_sandbox?: boolean
          last_changed_at?: string
          last_checked_at?: string | null
          name?: string
          next_check_at?: string | null
          owner_id?: string
          ownership?: Json
          record?: Json
          supersession?: Json | null
          version?: number
        }
        Relationships: []
      }
      lookups: {
        Row: { at: string; domain_id: string | null; id: number; kind: string; owner_id: string }
        Insert: { at?: string; domain_id?: string | null; id?: never; kind: string; owner_id: string }
        Update: { at?: string; domain_id?: string | null; id?: never; kind?: string; owner_id?: string }
        Relationships: [
          {
            foreignKeyName: 'lookups_domain_id_fkey'
            columns: ['domain_id']
            isOneToOne: false
            referencedRelation: 'domains'
            referencedColumns: ['id']
          },
        ]
      }
      sandbox_zones: {
        Row: { domain_id: string; owner_id: string; version: number; zone: Json }
        Insert: { domain_id: string; owner_id: string; version?: number; zone: Json }
        Update: { domain_id?: string; owner_id?: string; version?: number; zone?: Json }
        Relationships: [
          {
            foreignKeyName: 'sandbox_zones_domain_id_fkey'
            columns: ['domain_id']
            isOneToOne: true
            referencedRelation: 'domains'
            referencedColumns: ['id']
          },
        ]
      }
      sweep_runs: {
        Row: { at: string; checked: number; detail: string | null; due: number; failed: number; id: number }
        Insert: {
          at?: string
          checked?: number
          detail?: string | null
          due?: number
          failed?: number
          id?: never
        }
        Update: {
          at?: string
          checked?: number
          detail?: string | null
          due?: number
          failed?: number
          id?: never
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      apply_transition: {
        Args: {
          p_domain_id: string
          p_events?: Json
          p_last_changed_at: string
          p_last_checked_at: string | null
          p_next_check_at: string | null
          p_now: string
          p_ownership: Json
          p_record: Json
          p_supersession: Json
          p_version: number
          p_hidden_at?: string | null
        }
        Returns: Json
      }
      create_claim: {
        Args: {
          p_again?: boolean
          p_is_sandbox: boolean
          p_name: string
          p_next_check_at: string
          p_now: string
          p_ownership: Json
        }
        Returns: Database['public']['Tables']['domains']['Row']
      }
      audit_timeline: {
        Args: {
          p_domain_id: string
          p_limit?: number
          p_before?: string | null
          p_before_id?: number | null
        }
        Returns: {
          id: number
          at: string
          kind: string
          actor: string
          level: string | null
          from_status: string | null
          to_status: string | null
          evidence: Json
        }[]
      }
      set_hidden: {
        Args: { p_domain_id: string; p_hidden: boolean; p_now: string }
        Returns: Database['public']['Tables']['domains']['Row']
      }
      claims_due: {
        Args: { p_limit?: number; p_now: string }
        Returns: Database['public']['Tables']['domains']['Row'][]
        SetofOptions: { from: '*'; to: 'domains'; isOneToOne: false; isSetofReturn: true }
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
