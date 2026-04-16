import React from 'react';
import { Loader2 } from 'lucide-react';

// === Layout ===

export const PageLayout: React.FC<{
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ title, subtitle, children, actions }) => (
  <div className="h-full w-full flex flex-col bg-zinc-50 dark:bg-suno-panel overflow-hidden">
    {title && (
      <div className="flex items-center justify-between px-5 pt-4 pb-2 flex-shrink-0">
        <div>
          <h1 className="text-sm font-bold text-zinc-900 dark:text-white">{title}</h1>
          {subtitle && <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
    )}
    <div className="flex-1 overflow-y-auto px-5 pb-24 scrollbar-hide">
      {children}
    </div>
  </div>
);

// === Card ===

export const Card: React.FC<{
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}> = ({ children, className = '', onClick, active }) => (
  <div
    className={`bg-white dark:bg-suno-card rounded-xl border ${active ? 'border-pink-500/50' : 'border-zinc-200 dark:border-white/5'} ${onClick ? 'cursor-pointer hover:border-zinc-300 dark:hover:border-white/10' : ''} ${className}`}
    onClick={onClick}
  >
    {children}
  </div>
);

export const CardHeader: React.FC<{
  title: string;
  subtitle?: string;
  children?: React.ReactNode; // right side actions
}> = ({ title, subtitle, children }) => (
  <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-white/5 border-b border-zinc-100 dark:border-white/5 rounded-t-xl">
    <div>
      <span className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{title}</span>
      {subtitle && <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">{subtitle}</p>}
    </div>
    {children && <div className="flex items-center gap-1">{children}</div>}
  </div>
);

// === Section ===

export const SectionHeader: React.FC<{
  title: string;
  subtitle?: string;
}> = ({ title, subtitle }) => (
  <div className="mt-4 mb-2">
    <h2 className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{title}</h2>
    {subtitle && <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">{subtitle}</p>}
  </div>
);

// === Form ===

export const FormRow: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <div className="flex items-center justify-between py-1.5">
    <div>
      <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      {hint && <p className="text-[9px] text-zinc-400 dark:text-zinc-500">{hint}</p>}
    </div>
    <div className="flex items-center gap-2">{children}</div>
  </div>
);

export const FormInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    {...props}
    className={`bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-900 dark:text-white focus:outline-none focus:border-pink-500 transition-colors ${props.className || ''}`}
  />
);

export const FormSelect: React.FC<React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }> = ({ children, ...props }) => (
  <select
    {...props}
    className={`bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-900 dark:text-white focus:outline-none focus:border-pink-500 cursor-pointer [&>option]:bg-white [&>option]:dark:bg-zinc-800 transition-colors ${props.className || ''}`}
  >
    {children}
  </select>
);

export const FormTextarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => (
  <textarea
    {...props}
    className={`w-full bg-transparent p-3 text-xs text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none resize-none ${props.className || ''}`}
  />
);

// === Buttons ===

export const Button: React.FC<{
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}> = ({ children, variant = 'secondary', size = 'sm', loading, disabled, onClick, className = '' }) => {
  const base = 'inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed';
  const sizes = { sm: 'px-2.5 py-1.5 text-[11px]', md: 'px-4 py-2 text-xs' };
  const variants = {
    primary: 'bg-pink-600 hover:bg-pink-700 text-white shadow-sm',
    secondary: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700',
    ghost: 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-white',
    danger: 'bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20',
  };
  return (
    <button onClick={onClick} disabled={disabled || loading} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {loading && <Loader2 size={12} className="animate-spin" />}
      {children}
    </button>
  );
};

export const IconButton: React.FC<{
  icon: React.ReactNode;
  onClick?: () => void;
  title?: string;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}> = ({ icon, onClick, title, active, disabled, className = '' }) => (
  <button
    onClick={onClick}
    title={title}
    disabled={disabled}
    className={`p-1.5 rounded-md transition-colors disabled:opacity-40 ${active ? 'text-pink-500 bg-pink-500/10' : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-white/10 hover:text-zinc-900 dark:hover:text-white'} ${className}`}
  >
    {icon}
  </button>
);

// === Badge ===

export const Badge: React.FC<{
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'pink';
  size?: 'sm' | 'md';
}> = ({ children, variant = 'default', size = 'sm' }) => {
  const variants = {
    default: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400',
    success: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    warning: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
    error: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    pink: 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-400',
  };
  const sizes = { sm: 'text-[9px] px-1.5 py-0.5', md: 'text-[10px] px-2 py-0.5' };
  return <span className={`inline-flex items-center gap-1 font-bold rounded-full ${variants[variant]} ${sizes[size]}`}>{children}</span>;
};

// === Toggle ===

export const Toggle: React.FC<{
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}> = ({ checked, onChange, disabled }) => (
  <button
    onClick={onChange}
    disabled={disabled}
    className={`w-9 h-5 rounded-full flex items-center transition-colors duration-200 px-0.5 border border-zinc-200 dark:border-white/5 ${checked ? 'bg-pink-600' : 'bg-zinc-300 dark:bg-black/40'} ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
  >
    <div className={`w-3.5 h-3.5 rounded-full bg-white transform transition-transform duration-200 shadow-sm ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
  </button>
);

// === Pill/Tag ===

export const Pill: React.FC<{
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}> = ({ children, active, onClick }) => (
  <button
    onClick={onClick}
    className={`text-[10px] font-medium px-2.5 py-1 rounded-full transition-colors border ${
      active
        ? 'bg-pink-600 text-white border-pink-500 shadow-sm shadow-pink-500/20'
        : 'bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white border-zinc-200 dark:border-white/5'
    }`}
  >
    {children}
  </button>
);
