/**
 * TOOLING SANITY CHECK
 * This test has nothing to do with Kaalchhaya business logic.
 * It exists solely to verify that Vitest + fast-check are wired up correctly.
 */
import { describe, it } from "vitest";
import * as fc from "fast-check";

describe("fast-check tooling sanity", () => {
  it("reversing an array twice returns the original array", () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), (arr) => {
        const roundTripped = [...arr].reverse().reverse();
        return JSON.stringify(roundTripped) === JSON.stringify(arr);
      }),
    );
  });
});
