import { useEffect, useRef } from "react";

export type SelectionState = "none" | "some" | "all";

interface SelectionCheckboxProps {
  state: SelectionState;
  label: string;
  title?: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

export function SelectionCheckbox({
  state,
  label,
  title,
  disabled = false,
  onChange,
}: SelectionCheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = state === "some";
  }, [state]);

  return (
    <label
      className={`selection-checkbox ${disabled ? "disabled" : ""}`}
      data-state={state}
      title={title}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="checkbox"
        checked={state === "all"}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="selection-checkbox-mark" aria-hidden="true" />
    </label>
  );
}
