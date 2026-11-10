import { useState } from "react";
import { History } from "lucide-react";
import { session } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
    <div className="backtest-workspace">
      <section
        className="backtest-panel backtest-preview"
        aria-labelledby="backtest-preview-title"
      >
        <header className="backtest-section-heading backtest-config-heading">
          <div className="resource-title-lockup">
            <span aria-hidden="true">
              <History />
            </span>
            <div>
              <h3 id="backtest-preview-title">Historical analysis preview</h3>
              <p className="backtest-note">
                See how a rule is evaluated after a signal. Run historical
                analysis with Pro.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            nativeButton={false}
            render={<a href="#app/subscription" />}
          >
            View Pro
          </Button>
        </header>
        <Badge variant="outline">Illustrative fixture data only</Badge>
        <Table>
          <TableCaption>
            Sample BUY signal · reference close 100 · next trading candle
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Price point</TableHead>
              <TableHead scope="col">Price</TableHead>
              <TableHead scope="col">Return</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Next open</TableCell>
              <TableCell>101</TableCell>
              <TableCell>+1%</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Next high</TableCell>
              <TableCell>103</TableCell>
              <TableCell>+3%</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Next close</TableCell>
              <TableCell>99</TableCell>
              <TableCell>−1%</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="backtest-note">
          The high shows potential price movement. Your saved archives remain
          available.
        </p>
      </section>
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
    </div>
  );
}
