import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  catalogPage,
  stockCategories,
  stockGroupLabel,
  universeSelectionLimit,
  type StockCategory,
} from "@/lib/stock-catalog";
import type { StockInstrument } from "@/types";
import "./stock-catalog-picker.css";

type Props = {
  catalog: StockInstrument[];
  selected: string[];
  loading: boolean;
  disabled: boolean;
  onToggle: (symbol: string) => void;
};

export function StockCatalogPicker({
  catalog,
  selected,
  loading,
  disabled,
  onToggle,
}: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<StockCategory>("all");
  const [requestedPage, setRequestedPage] = useState(0);
  const result = useMemo(
    () => catalogPage(catalog, query, requestedPage, category),
    [catalog, query, requestedPage, category],
  );
  const full = selected.length >= universeSelectionLimit;
  return (
    <div className="stock-catalog-picker" aria-busy={loading}>
      <div className="stock-catalog-picker__categories">
        <ToggleGroup
          aria-label="Stock categories"
          value={[category]}
          disabled={loading || disabled}
          onValueChange={(values) => {
            if (values[0]) {
              setCategory(values[0] as StockCategory);
              setRequestedPage(0);
            }
          }}
        >
          {stockCategories.map((item) => (
            <ToggleGroupItem key={item.id} value={item.id}>
              {item.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="stock-catalog-picker__toolbar">
        <Field data-disabled={loading || disabled}>
          <FieldLabel htmlFor="catalog-search">Search stocks</FieldLabel>
          <Input
            id="catalog-search"
            type="search"
            placeholder="Search symbol or company name"
            value={query}
            maxLength={80}
            disabled={loading || disabled}
            onChange={(event) => {
              setQuery(event.target.value);
              setRequestedPage(0);
            }}
          />
        </Field>
        <p
          id="catalog-selection-help"
          className="stock-catalog-picker__summary"
          role="status"
        >
          <strong>
            {selected.length} / {universeSelectionLimit}
          </strong>{" "}
          selected
          <span>
            {loading
              ? "Loading catalog…"
              : `${catalog.length.toLocaleString("en-GB")} stocks available`}
          </span>
        </p>
      </div>
      {selected.length > 0 && (
        <div
          className="stock-catalog-picker__selected"
          aria-label="Selected stocks"
        >
          {selected.map((symbol) => (
            <Button
              key={symbol}
              variant="outline"
              size="sm"
              disabled={disabled || loading}
              aria-label={`Remove ${symbol.replace(/\.JK$/, "")} from selection`}
              onClick={() => onToggle(symbol)}
            >
              {symbol.replace(/\.JK$/, "")}
              <X data-icon="inline-end" aria-hidden="true" />
            </Button>
          ))}
        </div>
      )}
      {full && (
        <p className="stock-catalog-picker__limit" role="status">
          Selection limit reached. Remove a stock to choose another.
        </p>
      )}
      <div className="stock-catalog-picker__table">
        <Table
          aria-label="Stock catalog"
          aria-describedby="catalog-selection-help"
        >
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Symbol</TableHead>
              <TableHead scope="col">Company</TableHead>
              <TableHead scope="col" className="stock-catalog-picker__group">
                Group
              </TableHead>
              <TableHead scope="col">
                <span className="sr-only">Selection</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 6 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton />
                    </TableCell>
                    <TableCell>
                      <Skeleton />
                    </TableCell>
                    <TableCell className="stock-catalog-picker__group">
                      <Skeleton />
                    </TableCell>
                    <TableCell>
                      <Skeleton />
                    </TableCell>
                  </TableRow>
                ))
              : result.items.map((stock) => {
                  const active = selected.includes(stock.symbol);
                  const code = stock.symbol.replace(/\.JK$/, "");
                  return (
                    <TableRow
                      key={stock.symbol}
                      data-state={active ? "selected" : undefined}
                    >
                      <TableCell>
                        <strong>{code}</strong>
                      </TableCell>
                      <TableCell>{stock.name}</TableCell>
                      <TableCell className="stock-catalog-picker__group">
                        {stockGroupLabel(stock)}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant={active ? "secondary" : "ghost"}
                          size="icon"
                          aria-label={`${active ? "Remove" : "Add"} ${code} ${stock.name}`}
                          aria-pressed={active}
                          disabled={disabled || (full && !active)}
                          onClick={() => onToggle(stock.symbol)}
                        >
                          {active ? (
                            <Check aria-hidden="true" />
                          ) : (
                            <Plus aria-hidden="true" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
          </TableBody>
        </Table>
        {!loading && result.totalMatches === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                {catalog.length === 0
                  ? "Catalog unavailable"
                  : "No matching stocks"}
              </EmptyTitle>
              <EmptyDescription>
                {catalog.length === 0
                  ? "Use Refresh to load the stock catalog again."
                  : "Try another company name or switch to All stocks."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
      <nav
        className="stock-catalog-picker__pagination"
        aria-label="Stock catalog pages"
      >
        <span>
          {loading
            ? "Loading…"
            : `${result.totalMatches.toLocaleString("en-GB")} results`}
        </span>
        <div>
          <Button
            variant="outline"
            size="icon"
            disabled={loading || disabled || result.page === 0}
            aria-label="Previous stock page"
            onClick={() => setRequestedPage(result.page - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span>
            Page {result.page + 1} of {result.pageCount}
          </span>
          <Button
            variant="outline"
            size="icon"
            disabled={
              loading || disabled || result.page + 1 === result.pageCount
            }
            aria-label="Next stock page"
            onClick={() => setRequestedPage(result.page + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </nav>
      <p className="stock-catalog-picker__note">
        Categories are curated shortcuts, not complete sector lists. Blue chip
        is not an official index.
      </p>
    </div>
  );
}
