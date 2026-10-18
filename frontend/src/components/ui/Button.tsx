import type { ComponentProps } from 'react';
import { Link } from 'react-router';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm' | 'icon';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: '',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};
const SIZE: Record<ButtonSize, string> = { md: '', sm: 'btn-sm', icon: 'btn-icon' };

interface Look {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** The button look, for elements that can't be a <Button> (e.g. a file input's label). */
export function buttonClass({ variant = 'secondary', size = 'md' }: Look = {}, extra = '') {
  return ['btn', VARIANT[variant], SIZE[size], extra].filter(Boolean).join(' ');
}

export function Button({ variant, size, className = '', type = 'button', ...props }: Look & ComponentProps<'button'>) {
  return <button type={type} className={buttonClass({ variant, size }, className)} {...props} />;
}

/** A link styled as a button. */
export function ButtonLink({ variant, size, className = '', ...props }: Look & ComponentProps<typeof Link>) {
  return <Link className={buttonClass({ variant, size }, className)} {...props} />;
}
