import { StyleSheet, Text, View } from "react-native";
import { formatFreshnessLine } from "../lib/freshness-display";
import type { FreshnessTier } from "../lib/freshness";

/**
 * The freshness line (spec table): normal "updated X min ago", muted while
 * aging, and a "data may be old" badge once stale. The caller renders the
 * "checking…" case itself while no snapshot exists.
 */
export function FreshnessLine({ tier, capturedAt, now }: { tier: FreshnessTier; capturedAt: string | null; now: Date }) {
  if (tier === "never") return null;
  const line = formatFreshnessLine(capturedAt, now);
  if (tier === "stale") {
    return (
      <View style={styles.badge} testID="freshness-stale-badge">
        <Text style={styles.badgeText}>{line}</Text>
      </View>
    );
  }
  return (
    <Text style={[styles.line, tier === "aging" ? styles.muted : null]}>{line}</Text>
  );
}

const styles = StyleSheet.create({
  line: {
    fontSize: 12,
    color: "#4b5563",
  },
  muted: {
    color: "#9ca3af",
    fontStyle: "italic",
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#fef3c7",
    borderColor: "#d97706",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#92400e",
  },
});
