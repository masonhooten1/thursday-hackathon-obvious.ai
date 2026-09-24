import cron from "node-cron";

type ScheduledTask = ReturnType<typeof cron.schedule>;

export interface Scheduler {
  start(): void;
  stop(): void;
}

/**
 * Wraps node-cron for the in-process 15-minute poll cycle. start() only arms
 * the timer — the poll cycle itself lands with the D4 poller.
 */
export function createScheduler(expression: string, task: () => void | Promise<void>): Scheduler {
  let scheduled: ScheduledTask | null = null;
  return {
    start() {
      if (scheduled) return;
      scheduled = cron.schedule(expression, () => {
        void task();
      });
    },
    stop() {
      scheduled?.stop();
      scheduled = null;
    },
  };
}
