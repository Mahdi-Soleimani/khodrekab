import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  fullWidth?: boolean;
}

export function Input({
  label,
  error,
  fullWidth = false,
  className = '',
  id,
  ...props
}: InputProps) {
  const inputId = id || Math.random().toString(36).substring(7);

  return (
    <div className={`flex flex-col gap-2 ${fullWidth ? 'w-full' : ''} ${className}`}>
      {label && (
        <label htmlFor={inputId} className="text-small font-medium text-[var(--color-text-secondary)]">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`h-11 px-4 rounded-md border ${
          error ? 'border-[var(--color-error)] focus:ring-[var(--color-error)]' : 'border-[var(--color-border)] focus:ring-[var(--color-primary)]'
        } focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors`}
        {...props}
      />
      {error && <span className="text-small text-[var(--color-error)]">{error}</span>}
    </div>
  );
}
