import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
} from "react";
import { Popover } from "@base-ui/react/popover";
import { DayPicker, type DropdownProps } from "react-day-picker";
import "react-day-picker/style.css";
import "@/styles/calendar.css";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  calendarDateValue,
  calendarValueError,
  parseCalendarDate,
  singaporeDateTime,
  SINGAPORE_TIME_LABEL,
} from "@/lib/calendar";

type DateInputProps = Omit<
  ComponentProps<"input">,
  "type" | "value" | "defaultValue" | "onChange" | "min" | "max"
> & {
  value: string;
  onValueChange: (value: string) => void;
  type?: "date" | "datetime-local";
  min?: string;
  max?: string;
};

function CalendarDropdown({
  options = [],
  value,
  onChange,
  "aria-label": ariaLabel,
  disabled,
  tabIndex,
  id,
  name,
}: DropdownProps) {
  return (
    <Select
      items={options.map((option) => ({
        value: String(option.value),
        label: option.label,
      }))}
      value={String(value)}
      disabled={disabled}
      name={name}
      onValueChange={(next) => {
        if (next !== null) {
          onChange?.({
            target: { value: next },
          } as ChangeEvent<HTMLSelectElement>);
        }
      }}
    >
      <SelectTrigger
        className="calendar-caption-select"
        id={id}
        aria-label={ariaLabel}
        tabIndex={tabIndex}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        className="calendar-caption-options"
        side="bottom"
        align="start"
        alignItemWithTrigger={false}
        sideOffset={6}
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={String(option.value)}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Editable ISO value + one themed, keyboard-accessible calendar for every form. */
export function DateInput({
  value,
  onValueChange,
  type = "date",
  min,
  max,
  disabled,
  required,
  id,
  className,
  ...props
}: DateInputProps) {
  const generatedId = useId(),
    inputId = id ?? generatedId;
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState({ source: value, draft: value });
  if (text.source !== value) setText({ source: value, draft: value });
  const draft = text.source === value ? text.draft : value;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(
    parseCalendarDate(value.slice(0, 10)) ??
      parseCalendarDate(singaporeDateTime().slice(0, 10))!,
  );
  const withTime = type === "datetime-local";
  const error = calendarValueError(draft, withTime, min, max);
  const selected = parseCalendarDate(value.slice(0, 10));
  const [clock, setClock] = useState(value.slice(11, 16) || "00:00");
  useEffect(() => {
    setClock(value.slice(11, 16) || "00:00");
  }, [value]);
  useEffect(() => {
    input.current?.setCustomValidity(error);
  }, [error]);
  const change = (next: string) => {
    // Keep incomplete typing visible, but never leave an old valid value in
    // parent state. Range limits still use native form validity, so both ends
    // of a date range can be edited in either order before submission.
    const nextValue = calendarValueError(next, withTime) ? "" : next;
    setText({ source: nextValue, draft: next });
    onValueChange(nextValue);
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next)
          setMonth(
            selected ?? parseCalendarDate(singaporeDateTime().slice(0, 10))!,
          );
        setOpen(next);
      }}
    >
      <InputGroup
        className={cn("signalgen-date-control", className)}
        data-disabled={disabled || undefined}
      >
        <InputGroupInput
          {...props}
          ref={input}
          id={inputId}
          type="text"
          value={draft}
          disabled={disabled}
          required={required}
          placeholder={withTime ? "YYYY-MM-DD HH:mm" : "YYYY-MM-DD"}
          aria-invalid={error ? true : props["aria-invalid"]}
          onChange={(event) => change(event.target.value.replace(" ", "T"))}
          onKeyDown={(event) => {
            props.onKeyDown?.(event);
            if (event.altKey && event.key === "ArrowDown" && !disabled) {
              event.preventDefault();
              setOpen(true);
            }
          }}
        />
        <InputGroupAddon align="inline-end">
          <Popover.Trigger
            disabled={disabled}
            aria-label="Open calendar"
            render={<Button variant="ghost" size="icon" />}
          >
            <CalendarDays />
          </Popover.Trigger>
        </InputGroupAddon>
      </InputGroup>
      <Popover.Portal>
        <Popover.Positioner
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="isolate z-50"
        >
          <Popover.Popup className="signalgen-date-popup" initialFocus={false}>
            <Popover.Title>
              {withTime ? "Choose date and time" : "Choose date"}
            </Popover.Title>
            <Popover.Description>{SINGAPORE_TIME_LABEL}</Popover.Description>
            <DayPicker
              mode="single"
              required
              today={parseCalendarDate(singaporeDateTime().slice(0, 10))}
              autoFocus
              month={month}
              onMonthChange={setMonth}
              selected={selected}
              showOutsideDays
              fixedWeeks
              captionLayout="dropdown"
              components={{ Dropdown: CalendarDropdown }}
              startMonth={new Date(1900, 0)}
              endMonth={new Date(2200, 11)}
              disabled={[
                ...(min && parseCalendarDate(min.slice(0, 10))
                  ? [{ before: parseCalendarDate(min.slice(0, 10))! }]
                  : []),
                ...(max && parseCalendarDate(max.slice(0, 10))
                  ? [{ after: parseCalendarDate(max.slice(0, 10))! }]
                  : []),
              ]}
              onSelect={(day) => {
                if (!day) return;
                change(calendarDateValue(day) + (withTime ? `T${clock}` : ""));
                if (!withTime) setOpen(false);
              }}
            />
            {withTime && (
              <div className="signalgen-date-time">
                <label htmlFor={`${inputId}-time`}>Time (SGT)</label>
                <Input
                  id={`${inputId}-time`}
                  type="time"
                  value={clock}
                  onChange={(event) => {
                    setClock(event.target.value);
                    if (selected && event.target.value)
                      change(
                        calendarDateValue(selected) + `T${event.target.value}`,
                      );
                  }}
                />
              </div>
            )}
            <div className="signalgen-date-footer">
              <Button
                variant="ghost"
                onClick={() => {
                  change("");
                  setOpen(false);
                }}
              >
                Clear
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
