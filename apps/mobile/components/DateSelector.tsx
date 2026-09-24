import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { formatNightLabel, horizonNights, weekendISO } from "../lib/dates";

export type DatePreset = "tonight" | "weekend" | "pick";

/**
 * Night selector over the 14-night horizon (spec): Tonight / This weekend /
 * Pick a date — picking reveals a scrollable row of night pills. The preset
 * segments stay in sync with the chosen date.
 */
export function DateSelector({
  selectedDate,
  tonight,
  onSelect,
}: {
  selectedDate: string;
  tonight: string;
  onSelect: (dateISO: string) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const nights = horizonNights(new Date(tonight));
  const activePreset: DatePreset =
    selectedDate === tonight ? "tonight" : selectedDate === weekendISO(new Date(tonight)) ? "weekend" : "pick";

  return (
    <View>
      <View style={styles.segmentRow}>
        <Segment label="Tonight" active={activePreset === "tonight"} onPress={() => onSelect(tonight)} />
        <Segment
          label="This weekend"
          active={activePreset === "weekend"}
          onPress={() => onSelect(weekendISO(new Date(tonight)))}
        />
        <Segment label="Pick a date" active={showPicker} onPress={() => setShowPicker((prev) => !prev)} />
      </View>
      {showPicker ? (
        <ScrollView horizontal contentContainerStyle={styles.nightRow} showsHorizontalScrollIndicator={false}>
          {nights.map((iso) => (
            <Pressable
              key={iso}
              onPress={() => onSelect(iso)}
              accessibilityRole="button"
              accessibilityState={{ selected: iso === selectedDate }}
              style={[styles.nightPill, iso === selectedDate ? styles.nightPillSelected : null]}
              testID={`night-${iso}`}
            >
              <Text style={iso === selectedDate ? styles.nightLabelSelected : styles.nightLabel}>
                {formatNightLabel(iso)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function Segment({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.segment, active ? styles.segmentActive : null]}
      testID={`preset-${label.toLowerCase().replace(" ", "-")}`}
    >
      <Text style={active ? styles.segmentLabelActive : styles.segmentLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  segmentRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  segment: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
    paddingVertical: 8,
    alignItems: "center",
  },
  segmentActive: {
    backgroundColor: "#111827",
    borderColor: "#111827",
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
  },
  segmentLabelActive: {
    fontSize: 13,
    fontWeight: "600",
    color: "#ffffff",
  },
  nightRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  nightPill: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  nightPillSelected: {
    backgroundColor: "#111827",
    borderColor: "#111827",
  },
  nightLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#374151",
  },
  nightLabelSelected: {
    fontSize: 12,
    fontWeight: "600",
    color: "#ffffff",
  },
});
