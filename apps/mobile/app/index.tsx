import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { SiteType } from "@campground/shared";
import { DateSelector } from "../components/DateSelector";
import { DetailSheet } from "../components/DetailSheet";
import { DelayedDataBanner, EmptyStateBanner } from "../components/EmptyState";
import { FreshnessLine } from "../components/FreshnessLine";
import { TypeChips } from "../components/TypeChips";
import { regionForPoints, type MapPoint } from "../components/map/mapTypes";
import MapView from "../components/map/MapView";
import { buildAvailabilityView, isMarkerVisible, type CampgroundView } from "../lib/filters";
import { tonightISO, weekendISO } from "../lib/dates";
import { getFreshnessTier } from "../lib/freshness";
import { useAvailability } from "../lib/use-availability";

const WEB_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

/** Re-renders on a timer so freshness lines age on screen. */
function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export default function TonightScreen() {
  const now = useNow();
  const { data, loading, refreshing, error, refresh } = useAvailability();
  const [tonight] = useState(() => tonightISO(new Date()));
  const [selectedDate, setSelectedDate] = useState(tonight);
  const [selectedTypes, setSelectedTypes] = useState<ReadonlySet<SiteType>>(new Set(["tent", "rv", "cabin", "group"]));
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const view = useMemo(
    () => (data ? buildAvailabilityView(data, [...selectedTypes], selectedDate, now) : null),
    [data, selectedTypes, selectedDate, now],
  );

  const allPoints = useMemo<MapPoint[]>(
    () =>
      (view?.campgrounds ?? []).map((entry) => ({
        id: entry.campground.facilityId,
        lat: entry.campground.lat,
        lng: entry.campground.lng,
        availability: entry.availability,
        stale: entry.freshness === "stale",
        label: entry.campground.name,
        count: entry.snapshot ? entry.freeOnSelectedNight : null,
      })),
    [view],
  );
  const region = useMemo(() => regionForPoints(allPoints), [allPoints]);
  const points = useMemo(() => {
    const visible = new Set(
      (view?.campgrounds ?? []).filter(isMarkerVisible).map((entry) => entry.campground.facilityId),
    );
    return allPoints.filter((point) => visible.has(point.id));
  }, [view, allPoints]);

  const selectedView: CampgroundView | null =
    (view?.campgrounds ?? []).find((entry) => entry.campground.facilityId === selectedId) ?? null;

  const toggleType = useCallback((type: SiteType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const handleMarkerPress = useCallback((id: number) => setSelectedId(id), []);
  const tryWeekend = useCallback(() => setSelectedDate(weekendISO(new Date(tonight))), [tonight]);

  const anyAvailable = view?.anyAvailable ?? false;
  const hasVisibleCampgrounds = points.length > 0;
  const headerTier = view ? getFreshnessTier(view.latestCapturedAt, now) : "never";

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        testID="tonight-screen"
      >
        <View style={styles.header}>
          <Text style={styles.title}>Campground Tonight</Text>
          {view ? (
            <View style={styles.headerMeta}>
              <Text style={styles.dateLine}>
                {view.date === tonight ? "Tonight" : "Selected night"} · {view.date}
              </Text>
              <FreshnessLine tier={headerTier} capturedAt={view.latestCapturedAt} now={now} />
            </View>
          ) : (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" />
              <Text style={styles.checkingText}>checking…</Text>
            </View>
          )}
        </View>

        <DateSelector selectedDate={selectedDate} tonight={tonight} onSelect={setSelectedDate} />
        <TypeChips selected={selectedTypes} onToggle={toggleType} />

        <View style={styles.mapContainer}>
          {loading ? (
            <View style={styles.mapPlaceholder}>
              <ActivityIndicator size="large" />
              <Text style={styles.checkingText}>Loading availability…</Text>
            </View>
          ) : (
            <MapView
              points={points}
              region={region}
              apiKey={WEB_MAPS_KEY}
              selectedId={selectedId}
              onMarkerPress={handleMarkerPress}
            />
          )}

          {error ? <DelayedDataBanner /> : null}
          {!error && !loading && hasVisibleCampgrounds && !anyAvailable ? (
            <EmptyStateBanner onTryWeekend={tryWeekend} />
          ) : null}

          {selectedView ? (
            <DetailSheet
              view={selectedView}
              tonight={tonight}
              selectedDate={selectedDate}
              selectedTypes={selectedTypes}
              now={now}
              onClose={() => setSelectedId(null)}
            />
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  content: {
    flexGrow: 1,
  },
  header: {
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 2,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#111827",
  },
  headerMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dateLine: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 24,
  },
  checkingText: {
    fontSize: 13,
    color: "#9ca3af",
    fontStyle: "italic",
  },
  mapContainer: {
    flex: 1,
    minHeight: 320,
    borderRadius: 12,
    overflow: "hidden",
    margin: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  mapPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
});
