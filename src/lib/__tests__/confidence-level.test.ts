import { describe, expect, it } from "vitest";
import { confidenceLevel } from "../aliases";

describe("読み取りの自信度の段階（画面の色分け）", () => {
  it("自信度と注意の文で high / mid / low", () => {
    expect(confidenceLevel(0.97, "")).toBe("high");
    expect(confidenceLevel(0.97, "訂正あり 20→25")).toBe("mid");
    expect(confidenceLevel(0.8, "")).toBe("mid");
    expect(confidenceLevel(0.5, "")).toBe("low");
  });

  it("送り主が得意先一覧に無い FAX の行は、自信度にかかわらず low（赤枠）", () => {
    expect(confidenceLevel(0.97, "", { customerKnown: false })).toBe("low");
    expect(confidenceLevel(0.6, "商品が1つに決まりません", { customerKnown: false })).toBe("low");
    expect(confidenceLevel(0.97, "", { customerKnown: true })).toBe("high");
  });
});
