import { useMemo } from "react";
import { StyleSheet } from "react-native";
import MapView, { Circle, Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import { markerColor, type MapViewProps } from "./mapTypes";

/**
 * Native map over the Google provider with terrain tiles (spec D5). Markers
 * are colored pins by availability; stale snapshots get a translucent ring.
 * Note: Google Maps on Android cannot dash a Circle stroke (react-native-maps
 * supports lineDashPattern on Apple Maps only), so the ring is solid here —
 * the dashed fidelity lives in the web markers.
 */
export default function NativeCampgroundMap({ points, region, onMarkerPress }: MapViewProps) {
  const initialRegion: Region = useMemo(
    () => ({
      latitude: region.lat,
      longitude: region.lng,
      latitudeDelta: region.latDelta,
      longitudeDelta: region.lngDelta,
    }),
    [region],
  );

  return (
    <MapView
      style={styles.map}
      provider={PROVIDER_GOOGLE}
      mapType="terrain"
      initialRegion={initialRegion}
      testID="campground-map"
    >
      {points.map((point) => (
        <Circle
          key={`ring-${point.id}`}
          center={{ latitude: point.lat, longitude: point.lng }}
          radius={2400}
          strokeWidth={2}
          strokeColor={point.stale ? markerColor(point.availability) + "88" : "transparent"}
          fillColor="transparent"
        />
      ))}
      {points.map((point) => (
        <Marker
          key={point.id}
          coordinate={{ latitude: point.lat, longitude: point.lng }}
          pinColor={markerColor(point.availability)}
          opacity={point.stale ? 0.75 : 1}
          title={point.label}
          description={point.count === null ? "Availability unknown" : `${point.count} sites free`}
          onPress={() => onMarkerPress(point.id)}
        />
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});
