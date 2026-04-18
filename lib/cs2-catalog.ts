/**
 * Tiny curated catalogue of popular CS2 skins for the picker UI.
 * The catalogue purposely stays small (covers ~95% of common lookups) so we
 * don't ship a multi-MB skin database to the browser. Users can still type
 * a custom market_hash_name in the picker if their skin isn't listed.
 *
 * Each entry pairs a base name (e.g. "AK-47 | Redline") with the wear
 * conditions Valve actually issues for that skin and whether StatTrak™ /
 * Souvenir variants exist. We compose the final `market_hash_name` at runtime
 * with {@link buildMarketHashName}.
 */

export type Wear =
  | "Factory New"
  | "Minimal Wear"
  | "Field-Tested"
  | "Well-Worn"
  | "Battle-Scarred";

export const ALL_WEARS: Wear[] = [
  "Factory New",
  "Minimal Wear",
  "Field-Tested",
  "Well-Worn",
  "Battle-Scarred",
];

/** Float ranges used by Valve to decide which wear bucket a float falls into. */
export const WEAR_FLOAT_RANGE: Record<Wear, { min: number; max: number }> = {
  "Factory New": { min: 0.0, max: 0.07 },
  "Minimal Wear": { min: 0.07, max: 0.15 },
  "Field-Tested": { min: 0.15, max: 0.38 },
  "Well-Worn": { min: 0.38, max: 0.45 },
  "Battle-Scarred": { min: 0.45, max: 1.0 },
};

export interface CatalogEntry {
  /** Plain base name without wear, e.g. "AK-47 | Redline". */
  base: string;
  /** Weapon family used to group rows in the picker. */
  group:
    | "Rifles"
    | "Snipers"
    | "Pistols"
    | "SMGs"
    | "Knives"
    | "Gloves"
    | "Stickers";
  /** Wears that Valve actually drops for this skin. */
  wears: Wear[];
  /** Whether the skin can also drop in StatTrak™. */
  stattrak: boolean;
  /** Whether the skin has a Souvenir variant. */
  souvenir: boolean;
  /** Extremely rough USD reference price for ordering / placeholder UX. */
  priceHintUsd?: number;
}

/**
 * Hand-picked, popular skins. Exact prices change daily — the `priceHintUsd`
 * column is just for sorting the picker; the live API still drives the
 * comparison numbers shown to the user.
 */
export const CS2_CATALOG: CatalogEntry[] = [
  // Rifles
  { base: "AK-47 | Redline", group: "Rifles", wears: ["Field-Tested", "Minimal Wear", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 17 },
  { base: "AK-47 | Asiimov", group: "Rifles", wears: ["Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 70 },
  { base: "AK-47 | Vulcan", group: "Rifles", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 270 },
  { base: "AK-47 | Neon Rider", group: "Rifles", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 90 },
  { base: "AK-47 | Bloodsport", group: "Rifles", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 130 },
  { base: "AK-47 | Fire Serpent", group: "Rifles", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: true, priceHintUsd: 1500 },
  { base: "M4A4 | Howl", group: "Rifles", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 6000 },
  { base: "M4A4 | Asiimov", group: "Rifles", wears: ["Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 80 },
  { base: "M4A4 | The Emperor", group: "Rifles", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 60 },
  { base: "M4A1-S | Hyper Beast", group: "Rifles", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 30 },
  { base: "M4A1-S | Cyrex", group: "Rifles", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 35 },
  { base: "M4A1-S | Printstream", group: "Rifles", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 220 },
  { base: "AUG | Akihabara Accept", group: "Rifles", wears: ["Factory New", "Minimal Wear", "Field-Tested"], stattrak: false, souvenir: false, priceHintUsd: 950 },
  { base: "FAMAS | Roll Cage", group: "Rifles", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 6 },

  // Snipers
  { base: "AWP | Dragon Lore", group: "Snipers", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: false, souvenir: true, priceHintUsd: 12000 },
  { base: "AWP | Asiimov", group: "Snipers", wears: ["Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 110 },
  { base: "AWP | Neo-Noir", group: "Snipers", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 85 },
  { base: "AWP | Wildfire", group: "Snipers", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 240 },
  { base: "AWP | Hyper Beast", group: "Snipers", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 95 },
  { base: "AWP | Lightning Strike", group: "Snipers", wears: ["Factory New", "Minimal Wear"], stattrak: false, souvenir: true, priceHintUsd: 720 },
  { base: "AWP | Containment Breach", group: "Snipers", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 75 },

  // Pistols
  { base: "Desert Eagle | Blaze", group: "Pistols", wears: ["Factory New", "Minimal Wear"], stattrak: false, souvenir: false, priceHintUsd: 350 },
  { base: "Desert Eagle | Printstream", group: "Pistols", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 130 },
  { base: "Desert Eagle | Code Red", group: "Pistols", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 22 },
  { base: "USP-S | Kill Confirmed", group: "Pistols", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 65 },
  { base: "USP-S | Neo-Noir", group: "Pistols", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 30 },
  { base: "Glock-18 | Fade", group: "Pistols", wears: ["Factory New", "Minimal Wear"], stattrak: false, souvenir: false, priceHintUsd: 320 },
  { base: "Glock-18 | Water Elemental", group: "Pistols", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 11 },
  { base: "P250 | See Ya Later", group: "Pistols", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 8 },

  // SMGs
  { base: "MP9 | Hot Rod", group: "SMGs", wears: ["Factory New", "Minimal Wear"], stattrak: false, souvenir: false, priceHintUsd: 18 },
  { base: "MAC-10 | Neon Rider", group: "SMGs", wears: ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 6 },
  { base: "P90 | Asiimov", group: "SMGs", wears: ["Field-Tested", "Well-Worn", "Battle-Scarred"], stattrak: true, souvenir: false, priceHintUsd: 22 },

  // Knives — exotics intentionally limited; users can type custom for anything else.
  { base: "★ Karambit | Doppler", group: "Knives", wears: ["Factory New", "Minimal Wear"], stattrak: true, souvenir: false, priceHintUsd: 1500 },
  { base: "★ Karambit | Fade", group: "Knives", wears: ["Factory New"], stattrak: true, souvenir: false, priceHintUsd: 2400 },
  { base: "★ Butterfly Knife | Fade", group: "Knives", wears: ["Factory New"], stattrak: true, souvenir: false, priceHintUsd: 2200 },
  { base: "★ Bayonet | Tiger Tooth", group: "Knives", wears: ["Factory New"], stattrak: true, souvenir: false, priceHintUsd: 700 },
  { base: "★ Flip Knife | Marble Fade", group: "Knives", wears: ["Factory New"], stattrak: true, souvenir: false, priceHintUsd: 600 },

  // Gloves
  { base: "★ Sport Gloves | Pandora's Box", group: "Gloves", wears: ["Field-Tested", "Minimal Wear", "Well-Worn", "Battle-Scarred"], stattrak: false, souvenir: false, priceHintUsd: 2500 },
  { base: "★ Specialist Gloves | Crimson Kimono", group: "Gloves", wears: ["Field-Tested", "Minimal Wear", "Well-Worn", "Battle-Scarred"], stattrak: false, souvenir: false, priceHintUsd: 1800 },
];

/**
 * Compose a Steam-style market_hash_name. Knives + gloves already include the
 * "★" prefix in the base name; we only need to add StatTrak / Souvenir tags.
 */
export function buildMarketHashName(opts: {
  base: string;
  wear: Wear | null;
  stattrak: boolean;
  souvenir: boolean;
}): string {
  const prefix = opts.stattrak
    ? opts.base.startsWith("★")
      ? "★ StatTrak™ "
      : "StatTrak™ "
    : opts.souvenir
      ? "Souvenir "
      : "";
  const baseClean = opts.base.startsWith("★")
    ? opts.base.replace(/^★\s*/, "")
    : opts.base;
  const head = `${prefix}${baseClean}`;
  return opts.wear ? `${head} (${opts.wear})` : head;
}

export const CS2_GROUPS: CatalogEntry["group"][] = [
  "Rifles",
  "Snipers",
  "Pistols",
  "SMGs",
  "Knives",
  "Gloves",
];
