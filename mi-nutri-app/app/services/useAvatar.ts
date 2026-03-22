import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { supabase } from "./supabase";

export const AVATAR_KEY = "nutri_avatar";

/** Loads avatar from local cache (instant) then syncs from Supabase (cross-device). */
export function useAvatar() {
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      // 1. Local cache — instant display
      AsyncStorage.getItem(AVATAR_KEY).then((v) => { if (v) setAvatarUri(v); });

      // 2. Supabase sync — cross-device
      supabase.auth.getSession().then(({ data }) => {
        const uid = data.session?.user?.id;
        if (!uid) return;
        supabase.from("perfiles").select("avatar_url").eq("id", uid).single()
          .then(({ data: perfil }) => {
            if (perfil?.avatar_url) {
              setAvatarUri(perfil.avatar_url);
              AsyncStorage.setItem(AVATAR_KEY, perfil.avatar_url);
            }
          });
      });
    }, [])
  );

  return avatarUri;
}
