import { useEffect, useState } from "react";
import { MAX_TEXT_SIZE, MIN_TEXT_SIZE } from "../../services/textSize";

export default function FontSizeControl({
  value,
  label,
  onChange,
  disabled = false,
}: {
  value: number;
  label: string;
  onChange: (size: number) => void;
  disabled?: boolean;
}) {
  const [input, setInput] = useState(String(value));
  useEffect(() => setInput(String(value)), [value]);
  return (
    <div className="font-size-control">
      <label>
        {label}
        <span>
          <input
            aria-label={label}
            type="number"
            min={MIN_TEXT_SIZE}
            max={MAX_TEXT_SIZE}
            step="0.5"
            value={input}
            disabled={disabled}
            onBlur={() => setInput(String(value))}
            onChange={(e) => {
              setInput(e.target.value);
              const n = e.target.valueAsNumber;
              if (n >= MIN_TEXT_SIZE && n <= MAX_TEXT_SIZE) onChange(n);
            }}
          />{" "}
          pt
        </span>
      </label>
      <input
        aria-label={`${label} slider`}
        type="range"
        min={MIN_TEXT_SIZE}
        max={MAX_TEXT_SIZE}
        step="0.5"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="width-scale">
        <span>1 pt</span>
        <span>200 pt</span>
      </div>
    </div>
  );
}
