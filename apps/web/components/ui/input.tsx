import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  hint?: string;
  error?: string;
  size?: "sm" | "md" | "lg";
  mono?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

export function Input({
  label,
  hint,
  error,
  size = "md",
  mono = false,
  leadingIcon,
  trailingIcon,
  id,
  className = "",
  ...rest
}: InputProps) {
  const fid =
    id ||
    (label ? "mx-" + label.replace(/\s+/g, "-").toLowerCase() : undefined);
  return (
    <div className="mx-field">
      {label ? (
        <label className="mx-field__label" htmlFor={fid}>
          {label}
        </label>
      ) : null}
      <div className="mx-input-wrap">
        {leadingIcon ? (
          <span className="mx-input__icon mx-input__icon--lead">
            {leadingIcon}
          </span>
        ) : null}
        <input
          id={fid}
          className={cn(
            "mx-input",
            size !== "md" && `mx-input--${size}`,
            mono && "mx-input--mono",
            error && "mx-input--err",
            leadingIcon && "mx-input--has-lead",
            trailingIcon && "mx-input--has-trail",
            className,
          )}
          aria-invalid={!!error}
          {...rest}
        />
        {trailingIcon ? (
          <span className="mx-input__icon mx-input__icon--trail">
            {trailingIcon}
          </span>
        ) : null}
      </div>
      {error ? (
        <span className="mx-field__hint mx-field__hint--err">{error}</span>
      ) : hint ? (
        <span className="mx-field__hint">{hint}</span>
      ) : null}
    </div>
  );
}
