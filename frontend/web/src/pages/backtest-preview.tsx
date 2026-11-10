import { useState } from "react";
import { session } from "@/api/client";
import { BacktestHistoryPanel } from "./backtest-history-panel";
import { BacktestResults } from "./backtest-results";
import type { BacktestArchive } from "@/analysis/backtest-history";

// Static learning example only: no dataset, compute, study or scoring requests.
export function BacktestPreview({
  userId,
  authenticated,
}: {
  userId?: string;
  authenticated: boolean;
}) {
  const [archive, setArchive] = useState<BacktestArchive | null>(null);
  return (
    <section className="backtest-preview">
      <div className="tier-notice">
        <strong>Historical analysis preview</strong>
        <span>
          Pro includes running historical analysis. Your saved archives remain
          available.
        </span>
        <a href="#app/subscription">View Pro</a>
      </div>
      <h3>Understand how a rule behaved after a signal</h3>
      <p>
        Illustrative fixture data only. These are not current prices, your
        screening results, or an executed backtest.
      </p>
      <table>
        <caption>
          Sample BUY signal · reference close 100 · next trading candle
        </caption>
        <thead>
          <tr>
            <th>Evaluation price</th>
            <th>Example value</th>
            <th>Direction return</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Next open</td>
            <td>101</td>
            <td>+1%</td>
          </tr>
          <tr>
            <td>Next high</td>
            <td>103</td>
            <td>+3% potential historical movement</td>
          </tr>
          <tr>
            <td>Next close</td>
            <td>99</td>
            <td>−1%</td>
          </tr>
        </tbody>
      </table>
      <p>
        Actual analysis evaluates completed signals over the selected history
        and reports coverage, wins, losses and unfinished horizons.
      </p>
      {authenticated && userId && (
        <BacktestHistoryPanel
          key={userId}
          owner={userId}
          allowUpload={false}
          revision={session.getIdentityRevision()}
          onOpen={setArchive}
        />
      )}
      {archive && (
        <BacktestResults
          result={archive.result}
          currency={archive.currency}
          title={archive.title}
          source={archive.source}
          archived
          onClose={() => setArchive(null)}
        />
      )}
    </section>
  );
}
