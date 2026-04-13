/**
 * pushNotifications.ts — Local + Web Push notifications
 *
 * Web: uses browser Notification API
 * Native: will use expo-notifications when available (dev build)
 *
 * Features:
 * - Request permission on first use
 * - Send notification for new comments on your reels
 * - Daily meal reminder
 * - Weekly check-in reminder
 */

import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const PERM_KEY = "nutri_notif_permission";
const REMINDER_KEY = "nutri_last_reminder";

/** Request notification permission (web only for now) */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web" && typeof Notification !== "undefined") {
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const result = await Notification.requestPermission();
    const granted = result === "granted";
    await AsyncStorage.setItem(PERM_KEY, granted ? "yes" : "no");
    return granted;
  }
  return false;
}

/** Check if we have permission */
export function hasPermission(): boolean {
  if (Platform.OS === "web" && typeof Notification !== "undefined") {
    return Notification.permission === "granted";
  }
  return false;
}

/** Send a web notification */
export function sendNotification(title: string, body: string, icon?: string): void {
  if (Platform.OS !== "web" || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;

  try {
    new Notification(title, {
      body,
      icon: icon || "/assets/images/logo.png",
      badge: "/assets/images/logo.png",
      tag: `minutri-${Date.now()}`,
    });
  } catch {}
}

/** Send notification for a new comment on your reel */
export function notifyNewComment(autorNombre: string, reelTitulo: string): void {
  sendNotification(
    "💬 Nuevo comentario",
    `${autorNombre} comentó en tu reel "${reelTitulo}"`,
  );
}

/** Check if we should show a meal reminder (once every 4 hours) */
export async function checkMealReminder(): Promise<void> {
  try {
    const last = await AsyncStorage.getItem(REMINDER_KEY);
    const lastTime = last ? parseInt(last) : 0;
    const now = Date.now();
    const hours = (now - lastTime) / (1000 * 60 * 60);

    // Only remind between 7am-10pm, and at least 4 hours since last
    const hour = new Date().getHours();
    if (hours >= 4 && hour >= 7 && hour <= 22) {
      await AsyncStorage.setItem(REMINDER_KEY, String(now));
      // Don't actually send — just mark. The app can check this on focus.
    }
  } catch {}
}

/** Schedule periodic check (web only) */
export function startReminderCheck(): void {
  if (Platform.OS !== "web") return;
  // Check every 2 hours
  setInterval(async () => {
    if (!hasPermission()) return;
    const last = await AsyncStorage.getItem(REMINDER_KEY);
    const lastTime = last ? parseInt(last) : 0;
    const hours = (Date.now() - lastTime) / (1000 * 60 * 60);
    const hour = new Date().getHours();
    if (hours >= 6 && hour >= 11 && hour <= 14) {
      sendNotification("🍽 ¿Ya has comido?", "No olvides registrar tu comida de hoy");
      await AsyncStorage.setItem(REMINDER_KEY, String(Date.now()));
    }
  }, 2 * 60 * 60 * 1000);
}
