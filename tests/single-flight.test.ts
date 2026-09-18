import { describe, it, expect } from "vitest";
import { SingleFlight } from "../core";

const deferred = () => { let r!: () => void; const p = new Promise<void>((res) => { r = res; }); return { p, r }; };

describe("SingleFlight — a double-click must not start two conversions", () => {
  it("runs the first task and refuses the second while it is in flight", async () => {
    const sf = new SingleFlight(); const d = deferred(); let ran = 0, busy = 0;
    const first = sf.run(async () => { ran++; await d.p; return "a"; }, () => { busy++; });
    const second = await sf.run(async () => { ran++; return "b"; }, () => { busy++; });
    expect(second).toBeUndefined(); expect(ran).toBe(1); expect(busy).toBe(1); expect(sf.busy).toBe(true);
    d.r(); expect(await first).toBe("a"); expect(sf.busy).toBe(false);
  });
  it("accepts a new task once the first has finished", async () => {
    const sf = new SingleFlight();
    await sf.run(async () => 1, () => {});
    expect(await sf.run(async () => 2, () => { throw new Error("should not be busy"); })).toBe(2);
  });
  it("releases after a throw — one failed conversion must not lock the plugin", async () => {
    const sf = new SingleFlight();
    await expect(sf.run(async () => { throw new Error("engine died"); }, () => {})).rejects.toThrow("engine died");
    expect(sf.busy).toBe(false);
    expect(await sf.run(async () => "ok", () => {})).toBe("ok");
  });
});
