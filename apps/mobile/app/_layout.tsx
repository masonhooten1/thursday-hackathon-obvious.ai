import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      {/* The screen renders its own header; the router's default would paint
          the raw route name ("index") above it — so it's hidden. */}
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false, title: "Campground Tonight" }} />
      </Stack>
    </>
  );
}
