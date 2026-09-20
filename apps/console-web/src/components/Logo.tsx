import React from 'react';

interface LogoProps {
  /** Size in pixels (applies to width/height of icon or height of full logo) */
  size?: number;
  /**
   * 'icon': Just the chamber & mirror icon mark
   * 'horizontal': Icon + "镜舱 JingCang" horizontal layout (default for navbar)
   * 'vertical': Stacked icon + title + subtitle (great for login/hero)
   */
  variant?: 'icon' | 'horizontal' | 'vertical';
  /** Show subtle ambient glow effect */
  glow?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export const LogoIcon: React.FC<{ size?: number; glow?: boolean; className?: string }> = ({
  size = 36,
  glow = false,
  className
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        filter: glow ? 'drop-shadow(0 0 12px rgba(56, 189, 248, 0.45))' : undefined,
        flexShrink: 0
      }}
    >
      <defs>
        {/* Outer Chamber Stroke Gradient */}
        <linearGradient id="jc-pod-border" x1="16" y1="12" x2="104" y2="108" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="50%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>

        {/* Chamber Interior Depth Gradient */}
        <linearGradient id="jc-pod-bg" x1="20" y1="20" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1e293b" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#0b1329" stopOpacity="0.98" />
        </linearGradient>

        {/* Mirror Left Wing (J-facet) - Cyan */}
        <linearGradient id="jc-mirror-cyan" x1="24" y1="36" x2="60" y2="92" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.9" />
          <stop offset="40%" stopColor="#0ea5e9" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#0284c7" stopOpacity="0.6" />
        </linearGradient>

        {/* Mirror Right Wing (C-facet) - Indigo/Violet */}
        <linearGradient id="jc-mirror-indigo" x1="96" y1="36" x2="60" y2="92" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#a855f7" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#6366f1" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#4338ca" stopOpacity="0.6" />
        </linearGradient>

        {/* Top Viewport / Upper Glass Facet */}
        <linearGradient id="jc-mirror-top" x1="36" y1="24" x2="84" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f0fdf4" stopOpacity="0.4" />
          <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#818cf8" stopOpacity="0.4" />
        </linearGradient>

        {/* Core Speculum / Focal Lens Gradient */}
        <linearGradient id="jc-core-lens" x1="50" y1="44" x2="70" y2="68" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="50%" stopColor="#7dd3fc" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.6" />
        </linearGradient>

        {/* Glow Filter */}
        <filter id="jc-specular-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Outer Chamber Capsule (舱: Container / Pod Frame) */}
      <path
        d="M60 14
           C63.5 14 66.8 15.8 68.6 18.8
           L101.4 72.8
           C103.2 75.8 103.2 79.5 101.4 82.5
           L84.2 110.8
           C82.4 113.8 79.1 115.6 75.6 115.6
           H44.4
           C40.9 115.6 37.6 113.8 35.8 110.8
           L18.6 82.5
           C16.8 79.5 16.8 75.8 18.6 72.8
           L51.4 18.8
           C53.2 15.8 56.5 14 60 14 Z"
        fill="url(#jc-pod-bg)"
        stroke="url(#jc-pod-border)"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />

      {/* Chamber Internal Grid / Circuit Lines (Pod Structure) */}
      <path
        d="M60 16 L60 56 M18.6 77.6 L54 62 M101.4 77.6 L66 62"
        stroke="#334155"
        strokeWidth="1.5"
        strokeDasharray="2 3"
        strokeOpacity="0.7"
      />

      {/* Mirror Facet 1: Left Wing / J-Curve (镜 - Refraction Plane 1) */}
      <path
        d="M60 32
           L32 74
           C31 75.5 32 77.5 34 78
           L52 82
           C54 82.5 56 81.5 57 79.5
           L68 54
           L60 32 Z"
        fill="url(#jc-mirror-cyan)"
      />

      {/* Mirror Facet 2: Right Wing / C-Curve (镜 - Refraction Plane 2) */}
      <path
        d="M60 32
           L88 74
           C89 75.5 88 77.5 86 78
           L68 82
           C66 82.5 64 81.5 63 79.5
           L52 54
           L60 32 Z"
        fill="url(#jc-mirror-indigo)"
      />

      {/* Mirror Facet 3: Top Aperture / Viewport Roof (透光观察窗) */}
      <path
        d="M60 22
           L78 50
           L60 62
           L42 50
           Z"
        fill="url(#jc-mirror-top)"
        opacity="0.8"
      />

      {/* Center Prismatic Core (晶核 / 聚光多镜中心) */}
      <polygon
        points="60,42 72,56 60,70 48,56"
        fill="url(#jc-core-lens)"
        filter="url(#jc-specular-glow)"
      />

      {/* Dynamic Browser Node Lights (3 Nodes: Chrome, Firefox, Edge) */}
      <circle cx="42" cy="50" r="2.5" fill="#38bdf8" />
      <circle cx="78" cy="50" r="2.5" fill="#c084fc" />
      <circle cx="60" cy="70" r="2.5" fill="#60a5fa" />

      {/* Central Specular Reflection Sparkle */}
      <path
        d="M60 48 L61.5 54 L67.5 55.5 L61.5 57 L60 63 L58.5 57 L52.5 55.5 L58.5 54 Z"
        fill="#ffffff"
        opacity="0.9"
      />
    </svg>
  );
};

export const Logo: React.FC<LogoProps> = ({
  size = 32,
  variant = 'horizontal',
  glow = false,
  className,
  style
}) => {
  if (variant === 'icon') {
    return <LogoIcon size={size} glow={glow} className={className} />;
  }

  if (variant === 'vertical') {
    return (
      <div
        className={className}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          userSelect: 'none',
          ...style
        }}
      >
        <LogoIcon size={size * 1.6} glow={glow} />
        <div style={{ marginTop: '14px' }}>
          <div
            style={{
              fontSize: `${Math.round(size * 0.7)}px`,
              fontWeight: 700,
              letterSpacing: '1px',
              color: 'var(--text-main, #0f172a)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            <span>镜舱</span>
            <span
              style={{
                fontSize: `${Math.round(size * 0.42)}px`,
                fontWeight: 600,
                letterSpacing: '2px',
                color: '#38bdf8',
                textTransform: 'uppercase',
                background: 'linear-gradient(90deg, #38bdf8 0%, #818cf8 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent'
              }}
            >
              JingCang
            </span>
          </div>
          <div
            style={{
              fontSize: `${Math.round(size * 0.36)}px`,
              color: '#94a3b8',
              letterSpacing: '0.5px',
              marginTop: '4px',
              fontWeight: 400
            }}
          >
            同一页面 · 多镜验证
          </div>
        </div>
      </div>
    );
  }

  // Horizontal variant (default)
  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: `${Math.max(10, Math.round(size * 0.3))}px`,
        userSelect: 'none',
        ...style
      }}
    >
      <LogoIcon size={size} glow={glow} />
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.15 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
          <span
            style={{
              fontSize: `${Math.round(size * 0.54)}px`,
              fontWeight: 700,
              letterSpacing: '0.5px',
              color: 'var(--text-main, #0f172a)'
            }}
          >
            镜舱
          </span>
          <span
            style={{
              fontSize: `${Math.round(size * 0.36)}px`,
              fontWeight: 600,
              letterSpacing: '1px',
              background: 'linear-gradient(90deg, #38bdf8 0%, #818cf8 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              textTransform: 'uppercase'
            }}
          >
            JingCang
          </span>
        </div>
        <span
          style={{
            fontSize: `${Math.max(10, Math.round(size * 0.28))}px`,
            color: '#64748b',
            letterSpacing: '0.2px',
            marginTop: '2px'
          }}
        >
          Browser Pod Cloud
        </span>
      </div>
    </div>
  );
};
