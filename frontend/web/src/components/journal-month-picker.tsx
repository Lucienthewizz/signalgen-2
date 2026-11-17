import { useRef, useState } from "react";
import "@/styles/calendar.css";
import { Popover } from "@base-ui/react/popover";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseCalendarDate, singaporeDateTime } from "@/lib/calendar";

const months = Array.from({ length: 12 }, (_, index) => ({
  short: new Intl.DateTimeFormat("en", { month: "short" }).format(
    new Date(2000, index, 1),
  ),
  long: new Intl.DateTimeFormat("en", { month: "long" }).format(
    new Date(2000, index, 1),
  ),
}));

/** Month-only journal filter; dates and account data are not changed. */
export function JournalMonthPicker({
  value,
  onChange,
  description = "Exit month, or entry month for open trades. Singapore Time (SGT).",
}: {
  value: string;
  description?: string;
  onChange: (value: string) => void;
}) {
  const today = parseCalendarDate(singaporeDateTime().slice(0, 10))!;
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(today.getFullYear());
  const preferredMonth = useRef<HTMLButtonElement>(null);
  const selectedYear = value ? Number(value.slice(0, 4)) : today.getFullYear();
  const selectedMonth = value
    ? Number(value.slice(5, 7)) - 1
    : today.getMonth();
  const choose = (month: string) => {
    onChange(month);
    setOpen(false);
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setYear(selectedYear);
        setOpen(next);
      }}
    >
      <Popover.Trigger
        id="journal-month"
        render={<Button variant="outline" className="journal-month-trigger" />}
      >
        <span>
          {value
            ? `${months[selectedMonth].short} ${selectedYear}`
            : "All months"}
        </span>
        <CalendarDays data-icon="inline-end" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          align="start"
          sideOffset={8}
          collisionPadding={16}
          className="isolate z-50"
        >
          <Popover.Popup
            className="journal-month-popup"
            initialFocus={preferredMonth}
          >
            <Popover.Title>Filter by month</Popover.Title>
            <Popover.Description>{description}</Popover.Description>
            <div className="journal-month-year">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous year"
                disabled={year <= 1}
                onClick={() => setYear(year - 1)}
              >
                <ChevronLeft />
              </Button>
              <Input
                type="number"
                aria-label="Calendar year"
                min={1}
                max={9999}
                value={year}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isInteger(next) && next >= 1 && next <= 9999)
                    setYear(next);
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Next year"
                disabled={year >= 9999}
                onClick={() => setYear(year + 1)}
              >
                <ChevronRight />
              </Button>
            </div>
            <div
              className="journal-month-grid"
              role="group"
              aria-label={`Months in ${year}`}
            >
              {months.map((month, index) => (
                <Button
                  key={month.short}
                  ref={index === selectedMonth ? preferredMonth : undefined}
                  variant="ghost"
                  aria-label={`${month.long} ${year}`}
                  aria-pressed={
                    Boolean(value) &&
                    year === selectedYear &&
                    index === selectedMonth
                  }
                  onClick={() =>
                    choose(
                      `${String(year).padStart(4, "0")}-${String(index + 1).padStart(2, "0")}`,
                    )
                  }
                >
                  {month.short}
                </Button>
              ))}
            </div>
            <Button
              variant="ghost"
              className="journal-month-all"
              onClick={() => choose("")}
            >
              All months
            </Button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
