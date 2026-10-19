import { type ReactNode, useMemo, useState } from "react";
import {
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Fuel,
  Info,
  Landmark,
  LayoutGrid,
  Plus,
  ShieldCheck,
  ShoppingBag,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
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
  stockInCategory,
  universeSelectionLimit,
  type StockCategory,
} from "@/lib/stock-catalog";
import type { StockInstrument } from "@/types";
import "./stock-catalog-picker.css";

const categoryIcons = {
  all: LayoutGrid,
  "blue-chip": ShieldCheck,
  banks: Landmark,
  energy: Fuel,
  consumer: ShoppingBag,
  property: Building2,
  technology: Cpu,
};

type Props = {
  catalog: StockInstrument[];
  selected: string[];
  loading: boolean;
  disabled: boolean;
  onToggle: (symbol: string) => void;
  children?: ReactNode;
  header?: ReactNode;
};

export function StockCatalogPicker({
  catalog,
  selected,
  loading,
  disabled,
  onToggle,
  children,
  header,
}: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<StockCategory>("all");
  const [groupSort, setGroupSort] = useState("count");
  const groups = useMemo(
    () =>
      stockCategories
        .map((item) => {
          const stocks = catalog.filter((stock) =>
            stockInCategory(stock, item.id),
          );
          return { ...item, stocks };
        })
        .sort((a, b) =>
          a.id === "all"
            ? -1
            : b.id === "all"
              ? 1
              : groupSort === "count"
                ? b.stocks.length - a.stocks.length ||
                  a.label.localeCompare(b.label)
                : a.label.localeCompare(b.label),
        ),
    [catalog, groupSort],
  );
  const [requestedPage, setRequestedPage] = useState(0);
  const result = useMemo(
    () => catalogPage(catalog, query, requestedPage, category),
    [catalog, query, requestedPage, category],
  );
  const full = selected.length >= universeSelectionLimit;
  return (
    <div className="stock-catalog-picker" aria-busy={loading}>
      <section
        className="stock-catalog-picker__catalog"
        aria-label="Stock universe catalog"
      >
        {header}
        <div className="stock-catalog-picker__catalog-body">
          <section
            className="stock-catalog-picker__groups"
            aria-label="Browse stock groups"
          >
            <header>
              <h4>Stock groups</h4>
              <div className="stock-catalog-picker__sort">
                <span>Sort</span>
                <ToggleGroup
                  aria-label="Sort stock groups"
                  value={[groupSort]}
                  onValueChange={(values) => {
                    if (values[0]) setGroupSort(values[0]);
                  }}
                >
                  <ToggleGroupItem value="count">Most stocks</ToggleGroupItem>
                  <ToggleGroupItem value="name">A–Z</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </header>
            <ToggleGroup
              className="stock-catalog-picker__group-selector"
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
              <Table aria-label="Stock groups">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Group</TableHead>
                    <TableHead
                      scope="col"
                      className="stock-catalog-picker__samples"
                    >
                      Sample symbols
                    </TableHead>
                    <TableHead scope="col">Stocks</TableHead>
                    <TableHead scope="col">Selected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((item) => {
                    const CategoryIcon = categoryIcons[item.id];
                    return (
                      <TableRow
                        key={item.id}
                        data-state={
                          category === item.id ? "selected" : undefined
                        }
                      >
                        <TableCell>
                          <ToggleGroupItem value={item.id}>
                            <CategoryIcon
                              data-icon="inline-start"
                              aria-hidden="true"
                            />
                            {item.label}
                          </ToggleGroupItem>
                        </TableCell>
                        <TableCell className="stock-catalog-picker__samples">
                          <div>
                            {item.stocks.slice(0, 5).map((stock) => (
                              <span key={stock.symbol}>
                                {stock.symbol.replace(/\.JK$/, "")}
                              </span>
                            ))}
                            {item.stocks.length === 0 && <span>—</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          {loading
                            ? "—"
                            : item.stocks.length.toLocaleString("en-GB")}
                        </TableCell>
                        <TableCell>
                          {item.stocks.filter((stock) =>
                            selected.includes(stock.symbol),
                          ).length || "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ToggleGroup>
          </section>
          <div className="stock-catalog-picker__browse">
            <h4 className="stock-catalog-picker__current">
              {stockCategories.find((item) => item.id === category)?.label}
            </h4>
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
                <span>
                  {loading
                    ? "Loading catalog…"
                    : `${catalog.length.toLocaleString("en-GB")} stocks available`}
                </span>
              </p>
            </div>
            {!children && selected.length > 0 && (
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
                    <TableHead
                      scope="col"
                      className="stock-catalog-picker__group"
                    >
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
                        const group = stockCategories.find(
                          (item) =>
                            item.id !== "all" &&
                            item.id !== "blue-chip" &&
                            stockInCategory(stock, item.id),
                        );
                        const StockIcon = categoryIcons[group?.id ?? "all"];
                        return (
                          <TableRow
                            key={stock.symbol}
                            data-state={active ? "selected" : undefined}
                          >
                            <TableCell>
                              <span className="stock-catalog-picker__identity">
                                <StockIcon aria-hidden="true" />
                                <strong>{code}</strong>
                              </span>
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
            <details className="stock-catalog-picker__note">
              <summary>
                <Info aria-hidden="true" />
                About categories
              </summary>
              <p>
                Categories are curated shortcuts, not complete sector lists.
                Blue chip is not an official index.
              </p>
            </details>
          </div>
        </div>
      </section>
      {children && (
        <aside
          className="universe-selection"
          aria-labelledby="universe-selection-title"
        >
          <Card className="universe-selection__card">
            <CardHeader>
              <CardTitle>
                <h4 id="universe-selection-title">Selected stocks</h4>
              </CardTitle>
              <CardAction>
                <span role="status">
                  {selected.length} / {universeSelectionLimit}
                </span>
              </CardAction>
            </CardHeader>
            <CardContent>
              {selected.length ? (
                <ul
                  aria-label="Selected stocks"
                  className="universe-selection__stocks"
                >
                  {selected.map((symbol) => {
                    const stock = catalog.find(
                      (item) => item.symbol === symbol,
                    );
                    const code = symbol.replace(/\.JK$/, "");
                    return (
                      <li key={symbol}>
                        <div>
                          <strong>{code}</strong>
                          <span>{stock?.name ?? symbol}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={disabled || loading}
                          aria-label={`Remove ${code} from selection`}
                          onClick={() => onToggle(symbol)}
                        >
                          <X aria-hidden="true" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="universe-selection__empty">
                  Add stocks from the table to build your universe.
                </p>
              )}
            </CardContent>
            <CardFooter>{children}</CardFooter>
          </Card>
        </aside>
      )}
    </div>
  );
}
