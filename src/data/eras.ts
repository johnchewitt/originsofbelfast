import type { Era, EraId } from "../types/history";

/** Earliest and latest years on the timeline. */
export const TIMELINE_START = 600;
export const TIMELINE_END = 2026.99;

/** Centre of the historic core (Castle Place / High Street). */
export const CORE_CENTRE: [number, number] = [-5.9285, 54.5998];

/**
 * The ten principal eras. Summaries are written for this project; dated
 * claims are carried by the events dataset with their citations.
 */
export const ERAS: readonly Era[] = [
  {
    id: "origins",
    title: "Landscape and Origins",
    subtitle: "Before 1613",
    start: TIMELINE_START,
    end: 1613,
    summary:
      "A sandbank ford where the little River Farset met the tidal Lagan gave Belfast its name, Béal Feirste. A chapel, a castle and a handful of dwellings guarded the crossing. Settlement positions in this era are approximate.",
    camera: { target: [-5.9255, 54.6005], heading: 30, tilt: 62, range: 1500 },
    lighting: { month: 9, hour: 9 },
    weather: "foggy",
    accent: "#9fb7a8",
  },
  {
    id: "plantation",
    title: "The Plantation Town",
    subtitle: "1613 – 1700",
    start: 1613,
    end: 1700,
    summary:
      "Chichester's charter town: a brick castle, a market house, quays on the Farset and a bridge of twenty-one arches across the Lagan.",
    camera: { target: [-5.9265, 54.6000], heading: 40, tilt: 64, range: 1300 },
    lighting: { month: 6, hour: 11 },
    weather: "cloudy",
    accent: "#c9a46a",
  },
  {
    id: "georgian",
    title: "Georgian Belfast",
    subtitle: "1700 – 1790",
    start: 1700,
    end: 1791,
    summary:
      "Linen, printing and trade remake the town. The Exchange, the Poor House and the White Linen Hall rise; new streets push north and south; the Farset disappears under High Street.",
    camera: { target: [-5.9285, 54.6005], heading: 20, tilt: 63, range: 1800 },
    lighting: { month: 7, hour: 16 },
    weather: "sunny",
    accent: "#e8b76b",
  },
  {
    id: "revolution",
    title: "Revolution and Rebellion",
    subtitle: "1791 – 1800",
    start: 1791,
    end: 1801,
    summary:
      "The Society of United Irishmen is founded in a Belfast tavern. Within seven years its northern leaders lead a rising in Antrim and Down — and Henry Joy McCracken is hanged at the Market House.",
    camera: { target: [-5.9270, 54.6002], heading: 35, tilt: 66, range: 900 },
    lighting: { month: 7, hour: 19 },
    weather: "sunny",
    accent: "#e8b76b",
  },
  {
    id: "industrial",
    title: "Industrial Transformation",
    subtitle: "1800 – 1850",
    start: 1801,
    end: 1850,
    summary:
      "Steam mills, the first railways, a new stone bridge and a channel cut straight through the mudflats. An island rises from the dredged spoil.",
    camera: { target: [-5.9230, 54.6030], heading: 35, tilt: 62, range: 3000 },
    lighting: { month: 4, hour: 15 },
    weather: "cloudy",
    accent: "#b7a27a",
  },
  {
    id: "metropolis",
    title: "Industrial Metropolis",
    subtitle: "1850 – 1900",
    start: 1850,
    end: 1900,
    summary:
      "Linenopolis: terraces stretch out along every radial road, shipyards spread across Queen's Island and Belfast becomes a city in 1888.",
    camera: { target: [-5.9220, 54.6000], heading: 30, tilt: 58, range: 5200 },
    lighting: { month: 10, hour: 15 },
    weather: "foggy",
    accent: "#a7b6b4",
  },
  {
    id: "shipbuilders",
    title: "City of Shipbuilders",
    subtitle: "1900 – 1921",
    start: 1900,
    end: 1921,
    summary:
      "City Hall rises on the site of the White Linen Hall while the Arrol Gantry towers over the slipways where Olympic and Titanic are built.",
    camera: { target: [-5.9140, 54.6050], heading: 55, tilt: 62, range: 2900 },
    lighting: { month: 5, hour: 12 },
    weather: "cloudy",
    accent: "#49ead8",
  },
  {
    id: "partition",
    title: "Partition, Industry and War",
    subtitle: "1921 – 1945",
    start: 1921,
    end: 1945,
    summary:
      "Capital of Northern Ireland, with a parliament first in City Hall and then at Stormont. Depression hits the yards; in 1941 the Blitz kills about a thousand people.",
    camera: { target: [-5.9200, 54.6020], heading: 210, tilt: 58, range: 6000 },
    lighting: { month: 4, hour: 18 },
    weather: "cloudy",
    accent: "#8fb3c7",
  },
  {
    id: "conflict",
    title: "Change and Conflict",
    subtitle: "1945 – 1998",
    start: 1945,
    end: 1998,
    summary:
      "Redevelopment, motorways and the decline of heavy industry, set against the Troubles, in which some 1,500 people were killed in Belfast. Incidents are presented factually and without graphic detail.",
    camera: { target: [-5.9300, 54.5990], heading: 20, tilt: 60, range: 4800 },
    lighting: { month: 11, hour: 14 },
    weather: "rainy",
    accent: "#7fa7b0",
  },
  {
    id: "regeneration",
    title: "Regeneration and Modern Belfast",
    subtitle: "1998 – 2026",
    start: 1998,
    end: TIMELINE_END,
    summary:
      "After the Good Friday Agreement: the waterfront, the Titanic Quarter, Grand Central and the reopening of the historic entries.",
    camera: { target: [-5.9180, 54.6030], heading: 40, tilt: 64, range: 3600 },
    lighting: { month: 6, hour: 17 },
    weather: "sunny",
    accent: "#49ead8",
  },
];

/** Era containing `year` (the last era wins at the very end). */
export function eraForYear(year: number): Era {
  for (const era of ERAS) {
    if (year >= era.start && year < era.end) return era;
  }
  const last = ERAS[ERAS.length - 1];
  const first = ERAS[0];
  if (!last || !first) throw new Error("ERAS is empty");
  return year < first.start ? first : last;
}

export function eraById(id: EraId): Era {
  const era = ERAS.find((e) => e.id === id);
  if (!era) throw new Error(`Unknown era ${id}`);
  return era;
}

/** A representative "home" year for each era used by skip-era controls. */
export function eraHomeYear(era: Era): number {
  switch (era.id) {
    case "origins":
      return 1500;
    case "revolution":
      return 1791.8;
    case "regeneration":
      return 2026;
    default:
      return Math.round((era.start + era.end) / 2);
  }
}
