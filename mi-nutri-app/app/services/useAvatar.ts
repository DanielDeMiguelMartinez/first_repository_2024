import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

export const AVATAR_KEY = "nutri_avatar";

/** Loads the user's avatar URI from AsyncStorage and refreshes on screen focus. */
export function useAvatar() {
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(AVATAR_KEY).then((v) => setAvatarUri(v));
    }, [])
  );

  return avatarUri;
}
