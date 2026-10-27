import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  dynamicFamilies,
  indicatorGroups,
  indicatorLabel,
  indicatorLabels,
  operandParts,
} from "@/lib/indicators";

export function IndicatorInput({
  value,
  onChange,
  id,
  label,
  numeric = false,
}: {
  value: string;
  onChange(value: string): void;
  id: string;
  label: string;
  numeric?: boolean;
}) {
  const parts = operandParts(value);
  const items = [
    ...Object.entries(indicatorLabels).map(([value, label]) => ({
      value,
      label,
    })),
    ...dynamicFamilies.map((family) => ({
      value: `custom:${family}`,
      label: `Custom ${family.replaceAll("_", " ")} period`,
    })),
    ...(numeric ? [{ value: "number", label: "Numeric value" }] : []),
    ...(!(value in indicatorLabels) && value !== "number"
      ? [{ value, label: indicatorLabel(value) }]
      : []),
  ];
  return (
    <div className="indicator-input">
      <Select
        value={value}
        items={items}
        onValueChange={(selected) =>
          onChange(
            String(selected).startsWith("custom:")
              ? `${String(selected).slice(7)}20`
              : String(selected),
          )
        }
      >
        <SelectTrigger id={id} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {numeric && (
            <SelectGroup>
              <SelectItem value="number">Numeric value</SelectItem>
            </SelectGroup>
          )}
          {indicatorGroups.map(([group, values]) => (
            <SelectGroup key={group}>
              <SelectLabel>{group}</SelectLabel>
              {values?.map((key) => (
                <SelectItem key={key} value={key}>
                  {indicatorLabels[key]}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
          <SelectGroup>
            <SelectLabel>Custom periods · 1–250 candles</SelectLabel>
            {dynamicFamilies.map((family) => (
              <SelectItem key={family} value={`custom:${family}`}>
                Custom {family.replaceAll("_", " ")} period
              </SelectItem>
            ))}
          </SelectGroup>
          {!(value in indicatorLabels) && value !== "number" && (
            <SelectGroup>
              <SelectItem value={value}>{indicatorLabel(value)}</SelectItem>
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
      {value !== "number" && (
        <details className="indicator-parameters">
          <summary>Parameters / previous candle</summary>
          <div className="indicator-parameter-fields">
            {parts.family && (
              <label htmlFor={`${id}-period`}>
                Period (candles)
                <Input
                  id={`${id}-period`}
                  aria-label={`${label} period`}
                  type="number"
                  min={1}
                  max={250}
                  step={1}
                  value={parts.period}
                  onChange={(event) =>
                    onChange(
                      `${parts.family}${event.target.value}${parts.suffix ? "_PREV" : parts.offset !== "0" ? `_PREV_${parts.offset}` : ""}`,
                    )
                  }
                />
              </label>
            )}
            <label htmlFor={`${id}-offset`}>
              Previous candles
              <Input
                id={`${id}-offset`}
                aria-label={`${label} previous candles`}
                type="number"
                min={0}
                max={250}
                step={1}
                value={parts.offset}
                onChange={(event) =>
                  onChange(
                    event.target.value === "0"
                      ? parts.base
                      : `${parts.base}_PREV_${event.target.value}`,
                  )
                }
              />
            </label>
          </div>
          <small>
            0 = current completed candle. Period and history offset: 1–250.
          </small>
        </details>
      )}
    </div>
  );
}
