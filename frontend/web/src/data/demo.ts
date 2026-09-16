export type DemoRule = {
  id: string;
  name: string;
  logic: string;
  version: string;
  scope: "System" | "Milik Anda";
  enabled: boolean;
};

export type DemoTransaction = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  fee: number;
  date: string;
};

export const demoRules: DemoRule[] = [
  {
    id: "r-momentum",
    name: "Momentum confirmation",
    logic: "Close > EMA20 · RSI(14) 52–68 · Volume > SMA20",
    version: "v1.4",
    scope: "System",
    enabled: true,
  },
  {
    id: "r-breakout",
    name: "Quiet breakout",
    logic: "Close > High(20) · ATR contraction · Volume 1.5×",
    version: "v1.1",
    scope: "System",
    enabled: true,
  },
  {
    id: "r-pullback",
    name: "Pullback test",
    logic: "Trend up · Low ≤ EMA20 · Close > Open",
    version: "draft 03",
    scope: "Milik Anda",
    enabled: false,
  },
];

export const demoSignals = [
  {
    symbol: "BBCA",
    state: "Match",
    close: "9.675",
    score: "86",
    reason: "Trend, RSI, dan volume terkonfirmasi",
  },
  {
    symbol: "TLKM",
    state: "Match",
    close: "3.180",
    score: "78",
    reason: "Breakout valid; volume belum maksimal",
  },
  {
    symbol: "ASII",
    state: "Watch",
    close: "5.225",
    score: "64",
    reason: "Trend valid; RSI masih di bawah batas",
  },
  {
    symbol: "BMRI",
    state: "No match",
    close: "6.025",
    score: "48",
    reason: "Close kembali di bawah EMA20",
  },
];

export const initialTransactions: DemoTransaction[] = [
  {
    id: "tx-1",
    symbol: "BBCA",
    side: "BUY",
    quantity: 10,
    price: 9450,
    fee: 141,
    date: "2026-09-08",
  },
  {
    id: "tx-2",
    symbol: "TLKM",
    side: "BUY",
    quantity: 20,
    price: 3090,
    fee: 185,
    date: "2026-09-11",
  },
];

export const demoSessions = [
  {
    id: "current",
    device: "Chrome · MacBook Air",
    place: "Denpasar, ID",
    active: "Sekarang",
    current: true,
  },
  {
    id: "secondary",
    device: "Safari · iPhone",
    place: "Denpasar, ID",
    active: "2 jam lalu",
    current: false,
  },
];

export const faqItems = [
  [
    "Apakah Signalgen memberi rekomendasi beli atau jual?",
    "Tidak. Signalgen membantu Anda menyusun rule dan membaca bukti di balik sebuah signal. Keputusan investasi tetap sepenuhnya milik pengguna.",
  ],
  [
    "Apakah data di preview ini live?",
    "Belum. Seluruh angka di demo workspace adalah fixture statik untuk menguji alur dan kenyamanan UI sebelum API analisis tersedia.",
  ],
  [
    "Apakah rule bisa dibuat sendiri?",
    "Bisa pada scope MVP: pilih indikator, operator, dan nilai yang didukung. Rule sistem tetap read-only, sedangkan rule milik pengguna dapat diedit atau dihapus.",
  ],
  [
    "Bagaimana hasil analisis dijelaskan?",
    "Setiap hasil menampilkan status kondisi, alasan match, asumsi, versi rule, dan kualitas data—bukan hanya label signal tanpa konteks.",
  ],
  [
    "Apakah login web sudah terhubung?",
    "Login, register, dan pembacaan profil memakai endpoint authorization yang tersedia. Status koneksi API selalu ditampilkan dan kegagalan tidak disamarkan.",
  ],
];

export const sampleRatings = [
  {
    score: "4.8",
    role: "Active investor",
    quote:
      "Alurnya jelas: saya tahu rule apa yang berjalan dan kenapa sebuah saham lolos.",
  },
  {
    score: "4.6",
    role: "Swing trader",
    quote:
      "Tabel hasilnya padat tapi tetap mudah dipindai. Status demo juga tidak menyesatkan.",
  },
  {
    score: "4.9",
    role: "Research learner",
    quote:
      "Bagian jurnal terasa menyatu dengan analisis, bukan fitur terpisah yang ditempel.",
  },
];
