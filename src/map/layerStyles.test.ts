import { describe, expect, it } from "vitest";
import {
  adjustBrightness,
  applyPreset,
  defaultDisplayPrefs,
  luminance,
  massingColour,
  mixColours,
  performanceProfile,
  PRESETS,
  sanitizeDisplayPrefs,
  styleKey,
  BRIGHT_PERIOD_COLOURS,
  CLASSIC_PERIOD_COLOURS,
} from "./layerStyles";

describe("layer style helpers", () => {
  it("lightens towards white and darkens towards black", () => {
    expect(adjustBrightness("#804020", 1)).toBe("#804020");
    expect(adjustBrightness("#804020", 2)).toBe("#ffffff");
    expect(adjustBrightness("#804020", 0.5)).toBe("#402010");
    expect(luminance(adjustBrightness("#804020", 1.3))).toBeGreaterThan(luminance("#804020"));
  });

  it("mixes two colours", () => {
    expect(mixColours("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixColours("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixColours("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("makes the default palette brighter than the original one", () => {
    for (const [period, colour] of Object.entries(BRIGHT_PERIOD_COLOURS)) {
      expect(luminance(colour)).toBeGreaterThan(luminance(CLASSIC_PERIOD_COLOURS[period] as string));
    }
  });

  it("colours massing by period or with one colour, after brightness", () => {
    const style = PRESETS.bright.layers.massing;
    expect(massingColour(style, "georgian")).toBe(BRIGHT_PERIOD_COLOURS.georgian);
    expect(massingColour({ ...style, mode: "single", single: "#123456" }, "georgian")).toBe("#123456");
    expect(luminance(massingColour({ ...style, brightness: 1.4 }, "georgian"))).toBeGreaterThan(luminance(massingColour(style, "georgian")));
  });
});

describe("display preferences", () => {
  it("defaults to the bright preset, clear light, and fast mode on phones", () => {
    const desk = defaultDisplayPrefs(false);
    expect(desk.preset).toBe("bright");
    expect(desk.lighting).toBe("clear");
    expect(desk.performance).toBe("balanced");
    expect(defaultDisplayPrefs(true).performance).toBe("fast");
  });

  it("repairs malformed stored preferences field by field", () => {
    const fixed = sanitizeDisplayPrefs({
      lighting: "disco",
      performance: "fast",
      layers: {
        massing: { mode: "single", single: "#ABC", brightness: 9, opacity: -2, periods: { georgian: "#112233", bogus: "#000000", victorian: "red" } },
        streets: { colour: "not-a-colour", opacity: 0.4 },
      },
    });
    expect(fixed.lighting).toBe("clear");
    expect(fixed.performance).toBe("fast");
    expect(fixed.layers.massing.mode).toBe("single");
    expect(fixed.layers.massing.single).toBe("#aabbcc");
    expect(fixed.layers.massing.brightness).toBe(1.8);
    expect(fixed.layers.massing.opacity).toBe(0);
    expect(fixed.layers.massing.periods.georgian).toBe("#112233");
    expect(fixed.layers.massing.periods).not.toHaveProperty("bogus");
    expect(fixed.layers.massing.periods.victorian).toBe(BRIGHT_PERIOD_COLOURS.victorian);
    expect(fixed.layers.streets).toEqual({ colour: "#f2e8d5", opacity: 0.4 });
    expect(sanitizeDisplayPrefs("garbage").preset).toBe("bright");
  });

  it("separates style changes (new renderers) from opacity changes (cheap)", () => {
    const base = defaultDisplayPrefs();
    const fainter = { ...base, layers: { ...base.layers, streets: { ...base.layers.streets, opacity: 0.2 } } };
    expect(styleKey(fainter)).toBe(styleKey(base));
    const recoloured = { ...base, layers: { ...base.layers, streets: { ...base.layers.streets, colour: "#ff0000" } } };
    expect(styleKey(recoloured)).not.toBe(styleKey(base));
    expect(styleKey(applyPreset(base, "classic"))).not.toBe(styleKey(base));
    expect(styleKey({ ...base, performance: "fast" })).not.toBe(styleKey(base));
  });

  it("trades detail for speed in Fast mode", () => {
    const fast = performanceProfile("fast");
    const detailed = performanceProfile("detailed");
    expect(fast.shadows).toBe(false);
    expect(fast.edgesOverride).toBe("none");
    expect(fast.constructionAnimation).toBe(false);
    expect(fast.updateIntervalMs).toBeGreaterThan(detailed.updateIntervalMs);
    expect(performanceProfile("balanced").constructionAnimation).toBe(false);
    expect(detailed.constructionAnimation).toBe(true);
  });
});
