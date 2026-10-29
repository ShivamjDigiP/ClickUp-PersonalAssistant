import { describe, expect, it } from "vitest";
import { splitOptions } from "../components/cxo/Markdown";

describe("chat answers that ask for a choice", () => {
  it("turns the last OPTIONS line into buttons and removes it from the text", () => {
    const r = splitOptions("Which period should I use?\nOPTIONS: Last 30 days | Last 90 days | **Last year** | All time");
    expect(r.body).toBe("Which period should I use?");
    expect(r.options).toEqual(["Last 30 days", "Last 90 days", "Last year", "All time"]);
  });
  it("leaves normal answers alone", () => {
    expect(splitOptions("Shivam finished 29 tasks.")).toEqual({ body: "Shivam finished 29 tasks.", options: [] });
  });
});
