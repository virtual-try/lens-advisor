import type { JSX } from "preact";

export interface OptionCardProps {
  id?: string;
  name: string;
  value: string;
  title: string;
  description?: string;
  priceLabel?: string;
  checked: boolean;
  disabled?: boolean;
  reasonText?: string;
  reasonId?: string;
  badgeText?: string;
  onChange: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
}

export function OptionCard({
  id,
  name,
  value,
  title,
  description,
  priceLabel,
  checked,
  disabled = false,
  reasonText,
  reasonId,
  badgeText,
  onChange,
  onKeyDown,
  inputRef,
}: OptionCardProps): JSX.Element {
  const cardClassName = `la-choice${checked ? " la-choice--selected" : ""}${disabled ? " la-choice--disabled" : ""}`;

  return (
    <label class={cardClassName} htmlFor={id}>
      <input
        type="radio"
        id={id}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        aria-disabled={disabled ? "true" : undefined}
        aria-describedby={disabled && reasonId ? reasonId : undefined}
        onChange={onChange}
        onKeyDown={onKeyDown}
        ref={inputRef}
      />
      <span class="la-mark" aria-hidden="true" />
      <span class="la-choice__body">
        <span class="la-choice__title">
          {title}
          {badgeText ? <span class="la-badge">{badgeText}</span> : null}
        </span>
        {description ? <span class="la-choice__desc">{description}</span> : null}
        {disabled && reasonText && reasonId ? (
          <span class="la-choice__reason" id={reasonId}>
            <svg
              class="la-choice__reason-icon"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="6.5" />
              <path d="M8 7.2v4M8 4.8v.1" strokeLinecap="round" />
            </svg>
            <span>{reasonText}</span>
          </span>
        ) : null}
      </span>
      {priceLabel ? <span class="la-choice__price">{priceLabel}</span> : null}
    </label>
  );
}
