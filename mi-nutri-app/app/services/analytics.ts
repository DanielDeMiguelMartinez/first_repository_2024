// Simple analytics — tracks events to Supabase
import { supabase } from "./supabase";
import { Platform } from "react-native";

let _userId: string | null = null;

export function setAnalyticsUser(uid: string) { _userId = uid; }

export function trackEvent(event: string, data?: Record<string, any>) {
  if (!_userId) return;
  try {
    supabase.from("analytics").insert([{
      user_id: _userId,
      event,
      data: data ?? {},
      platform: Platform.OS,
      timestamp: new Date().toISOString(),
    }]).then(() => {}).catch(() => {});
  } catch {}
}

// Pre-defined events
export const Events = {
  APP_OPEN: "app_open",
  MEAL_ADDED: "meal_added",
  RECIPE_CREATED: "recipe_created",
  REEL_PUBLISHED: "reel_published",
  REEL_VIEWED: "reel_viewed",
  PHOTO_ANALYZED: "photo_analyzed",
  PLAN_GENERATED: "plan_generated",
  PROFILE_UPDATED: "profile_updated",
} as const;
