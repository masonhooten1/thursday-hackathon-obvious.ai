import { describe, expect, it } from "vitest";
import { createScheduler } from "./scheduler";

describe("createScheduler", () => {
  it("starts and stops without firing within the test", () => {
    let ticks = 0;
    const scheduler = createScheduler("0 0 1 1 *", () => {
      ticks += 1;
    });
    scheduler.start();
    scheduler.stop();
    expect(ticks).toBe(0);
  });

  it("tolerates repeated starts and stops", () => {
    const scheduler = createScheduler("0 0 1 1 *", () => {});
    scheduler.start();
    scheduler.start();
    scheduler.stop();
    scheduler.stop();
  });
});
