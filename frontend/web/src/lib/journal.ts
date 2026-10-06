type ClosedTrade = { pnl: number };

export function journalPerformance(records: ClosedTrade[]) {
  const wins = records.filter((record) => record.pnl > 0);
  const grossProfit = wins.reduce((sum, record) => sum + record.pnl, 0);
  const grossLoss = Math.abs(
    records
      .filter((record) => record.pnl < 0)
      .reduce((sum, record) => sum + record.pnl, 0),
  );
  let totalPnl = 0;
  const sequence = [
    0,
    ...[...records].reverse().map((record) => (totalPnl += record.pnl)),
  ];
  const low = Math.min(0, ...sequence);
  const high = Math.max(0, ...sequence);
  const range = high - low || 1;
  return {
    totalPnl,
    winRate: records.length
      ? Math.round((wins.length / records.length) * 100)
      : 0,
    averageWin: wins.length ? grossProfit / wins.length : 0,
    profitFactor: grossLoss ? grossProfit / grossLoss : null,
    chartCoordinates: sequence.map((value, index) => [
      3 + (index / Math.max(1, sequence.length - 1)) * 94,
      88 - ((value - low) / range) * 76,
    ]),
  };
}

export function localJournalDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
