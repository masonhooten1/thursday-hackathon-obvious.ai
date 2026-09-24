import { Pressable, StyleSheet, Text, View } from "react-native";

/**
 * Explicit empty state (spec): no sites free for this night in the selected
 * types — with a nudge to try the weekend — plus the delayed-data banner
 * used when a fetch fails and last-known data stays on screen.
 */
export function EmptyStateBanner({ onTryWeekend }: { onTryWeekend?: () => void }) {
  return (
    <View style={styles.banner} testID="empty-state">
      <Text style={styles.title}>No sites free for this night in the selected types</Text>
      {onTryWeekend ? (
        <Pressable onPress={onTryWeekend} accessibilityRole="button" style={styles.button} testID="try-weekend">
          <Text style={styles.buttonText}>Try this weekend</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function DelayedDataBanner() {
  return (
    <View style={styles.delayed} testID="delayed-banner">
      <Text style={styles.delayedText}>Availability data is delayed — showing the last known snapshot.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 12,
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    textAlign: "center",
  },
  button: {
    alignSelf: "center",
    backgroundColor: "#111827",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
  delayed: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    backgroundColor: "#fef3c7",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d97706",
    padding: 10,
  },
  delayedText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#92400e",
    textAlign: "center",
  },
});
