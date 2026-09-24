import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Linking from "expo-linking";
import type { SiteType } from "@campground/shared";
import { CHIP_TYPES, type CampgroundView } from "../lib/filters";
import { formatRelativeNight } from "../lib/dates";
import { FreshnessLine } from "./FreshnessLine";

/**
 * Bottom-sheet detail (spec): campground name and park, counts by type for
 * the selected night, freshness line, and Book on Recreation.gov — a deep
 * link to the official reservation page (new tab on web, system browser on
 * native via expo-linking).
 */
export function DetailSheet({
  view,
  tonight,
  selectedDate,
  selectedTypes,
  now,
  onClose,
}: {
  view: CampgroundView;
  tonight: string;
  selectedDate: string;
  selectedTypes: ReadonlySet<SiteType>;
  now: Date;
  onClose: () => void;
}) {
  const { campground, park, snapshot } = view;
  const nightLabel = formatRelativeNight(selectedDate, tonight);

  return (
    <View style={styles.sheet} testID="detail-sheet">
      <View style={styles.headerRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.name}>{campground.name}</Text>
          <Text style={styles.park}>{park ? `${park.name} · ${park.state}` : campground.parkId}</Text>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.close} testID="close-sheet">
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>

      <Text style={styles.summary}>
        {view.freeOnSelectedNight > 0
          ? `${view.freeOnSelectedNight} sites free ${nightLabel}`
          : view.availability === "soon"
            ? `Nothing ${nightLabel} — openings within 7 days`
            : `Nothing free ${nightLabel} in the selected types`}
      </Text>

      <View style={styles.typeRows}>
        {CHIP_TYPES.filter((type) => campground.siteTypes.includes(type)).map((type) => (
          <View
            key={type}
            style={[styles.typeRow, selectedTypes.has(type) ? null : styles.typeRowDimmed]}
            testID={`sheet-type-${type}`}
          >
            <Text style={styles.typeLabel}>{LABELS[type]}</Text>
            <Text style={styles.typeCount}>{view.countsByType[type]}</Text>
          </View>
        ))}
        {campground.siteTypes.includes("other") ? (
          <View style={styles.typeRow} testID="sheet-type-other">
            <Text style={styles.typeLabel}>Other</Text>
            <Text style={styles.typeCount}>{view.countsByType.other}</Text>
          </View>
        ) : null}
      </View>

      <NightStrip view={view} />

      <View style={styles.footerRow}>
        <FreshnessLine tier={view.freshness} capturedAt={snapshot?.capturedAt ?? null} now={now} />
        {view.freshness === "never" ? <Text style={styles.checking}>checking…</Text> : null}
      </View>

      <Pressable
        style={styles.bookButton}
        accessibilityRole="link"
        accessibilityLabel={`Book ${campground.name} on Recreation dot gov`}
        onPress={() => void Linking.openURL(campground.bookingUrl)}
        testID="book-button"
      >
        <Text style={styles.bookButtonText}>Book on Recreation.gov ↗</Text>
      </Pressable>
    </View>
  );
}

/** Compact 14-night strip of free-site counts for the selected types. */
function NightStrip({ view }: { view: CampgroundView }) {
  if (!view.snapshot) return null;
  const counts = view.snapshot.byType;
  const max = Math.max(1, ...selectedNightMax(counts));
  return (
    <View style={styles.strip} testID="night-strip">
      {counts.tent.map((_, i) => {
        const nightTotal = CHIP_TYPES.reduce((sum, type) => sum + (counts[type][i] ?? 0), 0) + (counts.other[i] ?? 0);
        const height = 4 + Math.round((nightTotal / max) * 28);
        return (
          <View
            key={i}
            style={[styles.stripBar, { height }, nightTotal === 0 ? styles.stripBarEmpty : null]}
          />
        );
      })}
    </View>
  );
}

function selectedNightMax(counts: Record<SiteType, number[]>): number[] {
  return counts.tent.map((_, i) =>
    CHIP_TYPES.reduce((sum, type) => sum + (counts[type][i] ?? 0), 0) + (counts.other[i] ?? 0),
  );
}

const LABELS: Record<SiteType, string> = {
  tent: "Tent",
  rv: "RV",
  cabin: "Cabin",
  group: "Group",
  other: "Other",
};

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 16,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 4,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
  },
  park: {
    fontSize: 13,
    color: "#6b7280",
  },
  close: {
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  closeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#374151",
  },
  summary: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  typeRows: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  typeRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  typeRowDimmed: {
    opacity: 0.45,
  },
  typeLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#374151",
  },
  typeCount: {
    fontSize: 12,
    fontWeight: "700",
    color: "#111827",
  },
  strip: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
    height: 34,
  },
  stripBar: {
    flex: 1,
    backgroundColor: "#15803d",
    borderRadius: 2,
  },
  stripBarEmpty: {
    backgroundColor: "#e5e7eb",
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 20,
  },
  checking: {
    fontSize: 12,
    color: "#9ca3af",
    fontStyle: "italic",
  },
  bookButton: {
    backgroundColor: "#15803d",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  bookButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
});
