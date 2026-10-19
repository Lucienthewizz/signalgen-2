import type { StockInstrument } from "@/types";

// This is a UX bound, not authorization. The API and database enforce it too.
export const universeSelectionLimit = 10;
export const catalogPageSize = 12;

// Editorial browsing shortcuts, not live index constituents or exhaustive IDX-IC
// membership. Sector vocabulary: https://www.idx.co.id/en/products/stocks/
export const stockCategories = [
  { id: "all", label: "All stocks" },
  { id: "blue-chip", label: "Blue chip" },
  { id: "banks", label: "Banks" },
  { id: "energy", label: "Energy" },
  { id: "consumer", label: "Consumer" },
  { id: "property", label: "Property" },
  { id: "technology", label: "Technology" },
] as const;
export type StockCategory = (typeof stockCategories)[number]["id"];

const categorySymbols: Record<
  Exclude<StockCategory, "all">,
  readonly string[]
> = {
  "blue-chip": [
    "BBCA",
    "BBRI",
    "BMRI",
    "BBNI",
    "ASII",
    "TLKM",
    "ICBP",
    "INDF",
    "UNTR",
    "KLBF",
  ],
  banks: [
    "BBCA",
    "BBRI",
    "BMRI",
    "BBNI",
    "BBTN",
    "BRIS",
    "BNGA",
    "NISP",
    "BDMN",
    "PNBN",
    "BNLI",
    "MEGA",
    "BJBR",
    "BJTM",
    "ARTO",
    "BBHI",
    "BBYB",
    "BTPN",
    "BTPS",
    "BBSI",
    "AGRO",
    "AGRS",
    "AMAR",
    "BABP",
    "BACA",
    "BANK",
    "BBKP",
    "BBMD",
    "BBYD",
    "BCIC",
    "BEKS",
    "BGTG",
    "BINA",
    "BMAS",
    "BNBA",
    "BNII",
    "BSIM",
    "BSWD",
    "BVIS",
    "DNAR",
    "INPC",
    "MAYA",
    "MCOR",
    "NOBU",
    "PNBS",
    "SDRA",
  ],
  energy: [
    "AADI",
    "ADMR",
    "PTBA",
    "ITMG",
    "HRUM",
    "BYAN",
    "BUMI",
    "DOID",
    "MEDC",
    "PGAS",
    "ELSA",
    "AKRA",
    "ABMM",
    "BSSR",
    "MBAP",
    "INDY",
    "ENRG",
    "TOBA",
  ],
  consumer: [
    "ICBP",
    "INDF",
    "MYOR",
    "UNVR",
    "ULTJ",
    "AMRT",
    "ROTI",
    "CMRY",
    "CPIN",
    "JPFA",
    "GOOD",
    "AALI",
    "DSNG",
    "LSIP",
    "SIMP",
  ],
  property: [
    "BSDE",
    "CTRA",
    "SMRA",
    "PWON",
    "DMAS",
    "ASRI",
    "DILD",
    "MTLA",
    "LPCK",
    "LPKR",
    "JRPT",
    "KIJA",
  ],
  technology: ["GOTO", "BUKA", "DCII", "EDGE", "MCAS", "DIVA", "MLPT", "WIRG"],
};

// Curated US browsing shortcuts, not exhaustive sector coverage or index membership.
// Company activities/sector references: https://www.ssga.com/us/en/individual/etfs
// Collision checks: https://www.gladstonecommercial.com/investors/company-information
// and https://adecoagro.com/en/food-agriculture/ . Never reuse IDX ticker membership.
const usCategorySymbols: typeof categorySymbols = {
  "blue-chip": [
    "AAPL",
    "MSFT",
    "NVDA",
    "JPM",
    "PG",
    "KO",
    "JNJ",
    "WMT",
    "XOM",
    "CVX",
  ],
  banks: ["JPM", "BAC", "WFC", "C", "USB", "PNC", "TFC", "COF", "FITB", "HBAN"],
  energy: [
    "XOM",
    "CVX",
    "COP",
    "EOG",
    "SLB",
    "OXY",
    "MPC",
    "PSX",
    "VLO",
    "KMI",
  ],
  consumer: [
    "PG",
    "KO",
    "PEP",
    "WMT",
    "COST",
    "MDLZ",
    "CL",
    "KMB",
    "GIS",
    "KHC",
    "AGRO",
  ],
  property: [
    "PLD",
    "AMT",
    "EQIX",
    "O",
    "SPG",
    "PSA",
    "CCI",
    "WELL",
    "VTR",
    "GOOD",
  ],
  technology: [
    "AAPL",
    "MSFT",
    "NVDA",
    "AVGO",
    "AMD",
    "ADBE",
    "CRM",
    "ORCL",
    "CSCO",
    "INTC",
    "QCOM",
    "TXN",
    "AMAT",
    "MU",
  ],
};

export function stockInCategory(
  stock: StockInstrument,
  category: StockCategory,
) {
  const symbols =
    stock.exchange === "XIDX" || stock.symbol.endsWith(".JK")
      ? categorySymbols
      : usCategorySymbols;
  return (
    category === "all" ||
    symbols[category].includes(stock.symbol.replace(/\.JK$/, ""))
  );
}

export function stockGroupLabel(stock: StockInstrument) {
  const group = stockCategories.find(
    (category) =>
      category.id !== "all" &&
      category.id !== "blue-chip" &&
      stockInCategory(stock, category.id),
  );
  return group?.label ?? "—";
}

// Match code or company name, without modifying/sorting the API's source array.
// Pagination keeps a full IDX catalog from creating hundreds of DOM controls.
export function catalogPage(
  catalog: readonly StockInstrument[],
  query: string,
  requestedPage: number,
  category: StockCategory = "all",
) {
  const terms = query
    .trim()
    .toLocaleLowerCase("id-ID")
    .split(/\s+/)
    .filter(Boolean);
  const matches = catalog.filter((stock) => {
    const text = `${stock.symbol} ${stock.name}`.toLocaleLowerCase("id-ID");
    return (
      stockInCategory(stock, category) &&
      terms.every((term) => text.includes(term))
    );
  });
  const pageCount = Math.max(1, Math.ceil(matches.length / catalogPageSize));
  const safePage = Number.isFinite(requestedPage)
    ? Math.trunc(requestedPage)
    : 0;
  const page = Math.min(Math.max(0, safePage), pageCount - 1);
  return {
    items: matches.slice(page * catalogPageSize, (page + 1) * catalogPageSize),
    totalMatches: matches.length,
    page,
    pageCount,
  };
}
