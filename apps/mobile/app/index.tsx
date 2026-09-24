import { StyleSheet, Text, View } from "react-native";

// Scaffold placeholder — the terrain map, filters, and booking deep links
// arrive with the map milestone (spec D5).
export default function TonightScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Campground Tonight</Text>
      <Text style={styles.subtitle}>
        Last-minute campsite availability in the national parks — tonight and the next 14 nights.
      </Text>
      <Text style={styles.note}>
        The terrain map, availability filters, and booking links land in the next milestones.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 16,
    textAlign: "center",
  },
  note: {
    fontSize: 13,
    opacity: 0.6,
    textAlign: "center",
  },
});
