import type { ExpoConfig } from "expo/config";

/**
 * App config. The Google Maps key is injected from the environment at config
 * time for native builds (react-native-maps provider=google) and never
 * committed. For web the key travels through the build-time env var
 * EXPO_PUBLIC_GOOGLE_MAPS_API_KEY, which Expo inlines into the bundle —
 * see docs/google-maps.md.
 */
export default {
  expo: {
    name: "Campground Tonight",
    slug: "campground-tonight",
    version: "0.1.0",
    scheme: "campground-tonight",
    platforms: ["ios", "android", "web"],
    plugins: ["expo-router", "expo-status-bar"],
    web: {
      bundler: "metro",
      output: "static",
    },
    ios: {
      config: {
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
      },
    },
    android: {
      config: {
        googleMaps: {
          apiKey: process.env.GOOGLE_MAPS_API_KEY,
        },
      },
    },
  },
} satisfies ExpoConfig;
