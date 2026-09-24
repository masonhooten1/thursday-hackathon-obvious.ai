import type { AvailabilitySnapshot, Campground } from "@campground/shared";

/**
 * A source of per-night availability. The only component that touches the
 * undocumented Recreation.gov reservation endpoints (see
 * docs/recreation-gov-endpoints.md); the poller can mark a source degraded and
 * keep serving last-known snapshots when an implementation throws.
 */
export interface AvailabilitySource {
  readonly name: string;
  /**
   * Returns a contract-valid snapshot for the window beginning at `start`
   * (interpreted as its UTC calendar date — the first night) and covering
   * `nights` nights. Throws on source failure; availability data is never
   * fabricated.
   */
  fetchFacilityAvailability(
    facilityId: number,
    start: Date,
    nights: number,
  ): Promise<AvailabilitySnapshot>;
}

/**
 * A source of campground metadata (name, coordinates, site types). RIDB is the
 * official implementation; it requires an API key (RIDB_API_KEY secret).
 */
export interface MetadataSource {
  fetchFacility(facilityId: number): Promise<Campground>;
}
