"use client";

import { useState, type ComponentProps } from "react";

/** Keep the in-progress decimal text while editing; format only after leaving. */
export function AmountInput({ value, onValueChange, plain = false, ...props }: Omit<ComponentProps<"input">, "value" | "onChange"> & {
  value: number | null;
  plain?: boolean;
  onValueChange: (value: number) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const formatted = value === null ? "" : plain ? String(value) : Number(value.toFixed(2)) === value ? value.toFixed(2) : String(value);
  return <input {...props} type="number" inputMode="decimal" value={editing ?? formatted}
    onFocus={event => { setEditing(event.target.value); props.onFocus?.(event); }}
    onBlur={event => { setEditing(null); props.onBlur?.(event); }}
    onChange={event => {
      const text = event.target.value;
      setEditing(text);
      const next = Number(text);
      if (Number.isFinite(next)) onValueChange(next);
    }} />;
}
