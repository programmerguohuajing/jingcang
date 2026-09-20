import React, { useState, useRef, useEffect } from 'react';
import { useTheme, ThemeMode } from '../context/ThemeContext';
import { Sun, Moon, Monitor, ChevronDown } from 'lucide-react';

interface ThemeToggleProps {
  compact?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ compact = false }) => {
  const { theme, effectiveTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const themeOptions: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: '浅色明亮', icon: <Sun size={15} /> },
    { value: 'dark', label: '深色极客', icon: <Moon size={15} /> },
    { value: 'system', label: '跟随系统', icon: <Monitor size={15} /> },
  ];

  const currentOption = themeOptions.find((opt) => opt.value === theme) || themeOptions[0];

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: compact ? '4px 8px' : '6px 12px',
          fontSize: '13px',
          fontWeight: 500,
          borderRadius: '6px',
          backgroundColor: 'var(--bg-subtle, #f1f5f9)',
          border: '1px solid var(--border-color, #e2e8f0)',
          color: 'var(--text-main, #0f172a)',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
        title={`当前主题: ${currentOption.label}（点击切换）`}
      >
        <span style={{ color: effectiveTheme === 'dark' ? '#fbbf24' : '#0284c7', display: 'flex' }}>
          {effectiveTheme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
        </span>
        {!compact && <span>{currentOption.label}</span>}
        <ChevronDown size={13} style={{ opacity: 0.6, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            minWidth: '135px',
            backgroundColor: 'var(--bg-surface, #ffffff)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: '8px',
            padding: '4px',
            boxShadow: 'var(--card-shadow, 0 10px 15px -3px rgba(0,0,0,0.1))',
            zIndex: 1100,
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          {themeOptions.map((opt) => {
            const isSelected = theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setTheme(opt.value);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '6px 10px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  textAlign: 'left',
                  backgroundColor: isSelected ? 'var(--primary-light-bg, rgba(2, 132, 199, 0.1))' : 'transparent',
                  color: isSelected ? 'var(--primary-color, #0284c7)' : 'var(--text-main, #0f172a)',
                  fontWeight: isSelected ? 600 : 400,
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background-color 0.15s',
                }}
              >
                <span style={{ color: isSelected ? 'var(--primary-color, #0284c7)' : 'var(--text-muted, #64748b)' }}>
                  {opt.icon}
                </span>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
