import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SiteType } from "@campground/shared";
import { CHIP_TYPES } from "../lib/filters";

/**
 * Multi-select site-type chips (spec: tent / rv / cabin / group). Counts on
 * the map and in the sheet respect exactly this selection.
 */
export function TypeChips({
  selected,
  onToggle,
}: {
  selected: ReadonlySet<SiteType>;
  onToggle: (type: SiteType) => void;
}) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {CHIP_TYPES.map((type) => {
        const isSelected = selected.has(type);
        return (
          <Pressable
            key={type}
            onPress={() => onToggle(type)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isSelected }}
            accessibilityLabel={`Filter by ${type} sites`}
            style={[styles.chip, isSelected ? styles.selected : styles.unselected]}
            testID={`chip-${type}`}
          >
            <Text style={[styles.label, isSelected ? styles.selectedLabel : styles.unselectedLabel]}>
              {LABELS[type]}
            </Text>
          </Pressable>
        );
      })}
    </View>
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
  row: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  selected: {
    backgroundColor: "#111827",
    borderColor: "#111827",
  },
  unselected: {
    backgroundColor: "#ffffff",
    borderColor: "#d1d5db",
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
  },
  selectedLabel: {
    color: "#ffffff",
  },
  unselectedLabel: {
    color: "#374151",
  },
});
