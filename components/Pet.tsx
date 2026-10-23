// The pets, drawn as SVG "stickers": chibi bodies with big glossy eyes, a white
// sticker outline and soft shading. Three lines (lib/pets.mjs), three forms
// each; later forms are bigger and grow their element's features.
//
//   volt   Bitpip -> Voltpaw -> Stormane      fox-cat, lightning tail, spark gem
//   ember  Emberbun -> Cindrabbit -> Blazelop bunny, flame tuft, fire-tipped ears
//   moss   Mossling -> Fernhog -> Grovehog    hedgehog with leaf spines, flowers

export type Species = "volt" | "ember" | "moss";
export type Form = 0 | 1 | 2;

const PALETTE = {
  volt: { base: "#FFD95E", light: "#FFF4BE", shade: "#EDB13A", line: "#A86B12", accent: "#B9A2F0", accentDark: "#7E62CF", belly: "#FFF2C6", inner: "#C9B5F7" },
  ember: { base: "#FFE6D2", light: "#FFF9F3", shade: "#F0BE9E", line: "#B0663F", accent: "#FF9A3D", accentDark: "#E04B2F", belly: "#FFF7EF", inner: "#FFB8A6" },
  moss: { base: "#A9DA87", light: "#E0F5CB", shade: "#75B559", line: "#467F38", accent: "#5FAE57", accentDark: "#3E8A45", belly: "#F4F8DA", inner: "#FFB2C8" },
} as const;

type Pal = (typeof PALETTE)[Species];

// Head/body layout per form. Form 0 is one round "mochi"; later forms have a head and body.
const LAYOUT = [
  { head: { cx: 100, cy: 118, r: 0 }, body: { cy: 125, rx: 54, ry: 47 }, eyeY: 122, eyeDx: 17, scale: 0.86 },
  { head: { cx: 100, cy: 90, r: 40 }, body: { cy: 146, rx: 34, ry: 30 }, eyeY: 94, eyeDx: 16, scale: 0.93 },
  { head: { cx: 100, cy: 86, r: 43 }, body: { cy: 146, rx: 38, ry: 33 }, eyeY: 90, eyeDx: 17, scale: 1 },
] as const;

const MOCHI = "M46 140 C46 98 70 76 100 76 C130 76 154 98 154 140 C154 162 132 171 100 171 C68 171 46 162 46 140 Z";
const BOLT = "M0 40 L22 14 L12 12 L36 -16 L6 8 L16 10 Z";
const FLAME = "M0 -26 C6 -14 14 -8 12 2 C10 10 -10 10 -12 2 C-14 -8 -4 -12 0 -26 Z";
const FLAME_CORE = "M0 -12 C3 -6 7 -3 6 2 C5 6 -5 6 -6 2 C-7 -3 -2 -6 0 -12 Z";
const LEAF = "M0 0 C-7 -8 -6 -20 0 -28 C6 -20 7 -8 0 0 Z";
const SPARKLE = "M0 -8 L2 -2 L8 0 L2 2 L0 8 L-2 2 L-8 0 L-2 -2 Z";

// Draws `children` on the left and again mirrored on the right.
function Pair({ children }: { children: React.ReactNode }) {
  return (
    <>
      <g>{children}</g>
      <g transform="matrix(-1 0 0 1 200 0)">{children}</g>
    </>
  );
}

export function Pet({
  species,
  form,
  id,
  size = 160,
  silhouette = false,
  animate = true,
  title,
  className,
}: {
  species: Species;
  form: Form;
  /** Unique per instance on a page: used for gradient and filter ids. */
  id: string;
  size?: number;
  /** A locked form: shown as a dark shape, Pokédex style. */
  silhouette?: boolean;
  animate?: boolean;
  title?: string;
  className?: string;
}) {
  const p = PALETTE[species];
  const L = LAYOUT[form];
  const u = (name: string) => `${id}-${name}`;
  const ref = (name: string) => `url(#${u(name)})`;

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      role="img"
      aria-label={title ?? "pet"}
      className={className}
    >
      <defs>
        <radialGradient id={u("body")} cx="38%" cy="30%" r="75%">
          <stop offset="0%" stopColor={p.light} />
          <stop offset="55%" stopColor={p.base} />
          <stop offset="100%" stopColor={p.shade} />
        </radialGradient>
        <linearGradient id={u("accent")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.accent} />
          <stop offset="100%" stopColor={p.accentDark} />
        </linearGradient>
        <linearGradient id={u("flame")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFD25C" />
          <stop offset="55%" stopColor="#FF9A3D" />
          <stop offset="100%" stopColor="#E04B2F" />
        </linearGradient>
        <radialGradient id={u("aura")} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={p.accent} stopOpacity="0.45" />
          <stop offset="100%" stopColor={p.accent} stopOpacity="0" />
        </radialGradient>
        {/* White sticker outline plus a soft brown drop shadow. */}
        <filter id={u("sticker")} x="-25%" y="-25%" width="150%" height="150%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="5" result="grown" />
          <feFlood floodColor="#FFFFFF" />
          <feComposite in2="grown" operator="in" result="outline" />
          <feGaussianBlur in="grown" stdDeviation="3" result="blur" />
          <feOffset in="blur" dy="4" result="drop" />
          <feFlood floodColor="#6B4532" floodOpacity="0.28" />
          <feComposite in2="drop" operator="in" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="outline" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={u("locked")}>
          <feFlood floodColor="#5B3A29" floodOpacity="0.85" />
          <feComposite in2="SourceAlpha" operator="in" />
        </filter>
      </defs>

      {form === 2 && !silhouette && <circle cx="100" cy="112" r="92" fill={ref("aura")} />}
      <ellipse cx="100" cy="184" rx={46 + form * 6} ry="8" fill="#6B4532" opacity={silhouette ? 0.1 : 0.16} />

      <g filter={silhouette ? ref("locked") : ref("sticker")}>
        {/* Scaled here; bobbing on the inner group (a CSS animation would replace this transform). */}
        <g transform={`translate(100 180) scale(${L.scale}) translate(-100 -180)`}>
          <g className={animate && !silhouette ? "pet-bob" : undefined}>
            <Back species={species} form={form} p={p} ref_={ref} uid={u} />
            <Body form={form} p={p} ref_={ref} uid={u} />
            <Front species={species} form={form} p={p} ref_={ref} uid={u} />
            {!silhouette && <Face species={species} form={form} />}
          </g>
        </g>
      </g>

      {form === 2 && !silhouette && (
        <g fill="#FFFFFF" className={animate ? "pet-twinkle" : undefined}>
          <path d={SPARKLE} transform="translate(30 52) scale(0.9)" />
          <path d={SPARKLE} transform="translate(172 70) scale(0.7)" />
          <path d={SPARKLE} transform="translate(160 26) scale(0.5)" />
        </g>
      )}
    </svg>
  );
}

type PartProps = { form: Form; p: Pal; ref_: (name: string) => string; uid: (name: string) => string };

function Body({ form, p, ref_ }: PartProps) {
  const L = LAYOUT[form];
  const line = { stroke: p.line, strokeWidth: 2.5, strokeLinejoin: "round" as const };
  if (form === 0) {
    return (
      <>
        <Pair>
          <ellipse cx="80" cy="170" rx="11" ry="6" fill={p.shade} {...line} />
        </Pair>
        <path d={MOCHI} fill={ref_("body")} {...line} />
        <ellipse cx="100" cy="150" rx="28" ry="15" fill={p.belly} opacity="0.75" />
        <ellipse cx="78" cy="98" rx="11" ry="6" transform="rotate(-30 78 98)" fill="#FFFFFF" opacity="0.45" />
      </>
    );
  }
  const { head, body } = L;
  return (
    <>
      <Pair>
        <ellipse cx={100 - 17} cy={body.cy + body.ry - 4} rx="13" ry="7" fill={p.shade} {...line} />
      </Pair>
      <ellipse cx="100" cy={body.cy} rx={body.rx} ry={body.ry} fill={ref_("body")} {...line} />
      <ellipse cx="100" cy={body.cy + 5} rx={body.rx * 0.6} ry={body.ry * 0.62} fill={p.belly} opacity="0.85" />
      <Pair>
        <ellipse
          cx={100 - body.rx + 4}
          cy={body.cy - 2}
          rx="9"
          ry="13"
          transform={`rotate(20 ${100 - body.rx + 4} ${body.cy - 2})`}
          fill={p.base}
          {...line}
        />
      </Pair>
      <circle cx={head.cx} cy={head.cy} r={head.r} fill={ref_("body")} {...line} />
      <ellipse
        cx={head.cx - head.r * 0.42}
        cy={head.cy - head.r * 0.52}
        rx="10"
        ry="5.5"
        transform={`rotate(-30 ${head.cx - head.r * 0.42} ${head.cy - head.r * 0.52})`}
        fill="#FFFFFF"
        opacity="0.45"
      />
    </>
  );
}

// Parts behind the body: ears, tails, spines.
function Back({ species, form, p, ref_, uid }: PartProps & { species: Species }) {
  const line = { stroke: p.line, strokeWidth: 2.5, strokeLinejoin: "round" as const };
  if (species === "volt") {
    const ear = [
      { outer: "M70 96 L74 62 L94 82 Z", inner: "M76 88 L78 71 L88 81 Z" },
      { outer: "M68 72 L70 22 L96 54 Z", inner: "M74 62 L75 36 L88 53 Z" },
      { outer: "M64 70 L60 8 L96 46 Z", inner: "M70 60 L67 24 L86 46 Z" },
    ][form];
    const tail = ["translate(140 112) scale(0.9)", "translate(124 116) scale(1.3)", "translate(118 96) scale(1.75)"][form];
    return (
      <>
        <path d={BOLT} transform={tail} fill={form === 2 ? ref_("accent") : p.shade} {...line} strokeWidth={2.5 / (form + 1)} />
        <Pair>
          <path d={ear.outer} fill={ref_("body")} {...line} />
          <path d={ear.inner} fill={p.inner} />
        </Pair>
      </>
    );
  }
  if (species === "ember") {
    const ear = [
      { cx: 82, cy: 74, rx: 10, ry: 20, rot: -18 },
      { cx: 84, cy: 30, rx: 11, ry: 30, rot: -10 },
      { cx: 82, cy: 34, rx: 12, ry: 31, rot: -14 },
    ][form];
    return (
      <>
        {form === 2 ? (
          <g transform="translate(146 150) rotate(50) scale(1.3)">
            <path d={FLAME} fill={ref_("flame")} {...line} strokeWidth={2} />
            <path d={FLAME_CORE} fill="#FFE27A" />
          </g>
        ) : (
          <circle cx={form === 0 ? 150 : 132} cy={form === 0 ? 150 : 158} r="11" fill={p.light} {...line} />
        )}
        <Pair>
          <g transform={`rotate(${ear.rot} ${ear.cx} ${ear.cy})`}>
            <clipPath id={uid("ear-tip")}>
              <ellipse cx={ear.cx} cy={ear.cy} rx={ear.rx} ry={ear.ry} />
            </clipPath>
            <ellipse cx={ear.cx} cy={ear.cy} rx={ear.rx} ry={ear.ry} fill={ref_("body")} />
            <ellipse cx={ear.cx} cy={ear.cy + 3} rx={ear.rx * 0.5} ry={ear.ry * 0.7} fill={p.inner} />
            {form > 0 && (
              <g clipPath={`url(#${uid("ear-tip")})`}>
                <rect x={ear.cx - ear.rx} y={ear.cy - ear.ry} width={ear.rx * 2} height={ear.ry * (form === 2 ? 0.7 : 0.5)} fill={ref_("flame")} />
              </g>
            )}
            <ellipse cx={ear.cx} cy={ear.cy} rx={ear.rx} ry={ear.ry} fill="none" {...line} />
          </g>
        </Pair>
      </>
    );
  }
  // moss: leaf spines fanned around the top of the head.
  const L = LAYOUT[form];
  const cy = form === 0 ? 120 : L.head.cy;
  const r = form === 0 ? 42 : L.head.r - 2;
  const count = [5, 9, 13][form];
  const scale = [0.8, 1.05, 1.3][form];
  const from = -170;
  const to = -10;
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const deg = from + ((to - from) * i) / (count - 1);
        const rad = (deg * Math.PI) / 180;
        const x = 100 + r * Math.cos(rad);
        const y = cy + r * Math.sin(rad);
        return (
          <path
            key={i}
            d={LEAF}
            transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg + 90}) scale(${scale})`}
            fill={i % 2 ? p.accentDark : p.accent}
            {...line}
            strokeWidth={2}
          />
        );
      })}
    </>
  );
}

// Parts in front of the body: crests, collars, gems, sprouts, flowers.
function Front({ species, form, p, ref_ }: PartProps & { species: Species }) {
  const L = LAYOUT[form];
  const line = { stroke: p.line, strokeWidth: 2.5, strokeLinejoin: "round" as const };
  const top = form === 0 ? 78 : L.head.cy - L.head.r + 2;
  if (species === "volt") {
    return (
      <>
        {form === 2 && (
          <>
            <path
              d="M60 118 L72 138 L80 121 L90 142 L100 123 L110 142 L120 121 L128 138 L140 118 Q100 132 60 118 Z"
              fill={p.shade}
              {...line}
            />
            <path d="M100 52 L108 61 L100 70 L92 61 Z" fill={ref_("accent")} {...line} strokeWidth={2} />
            <path d="M97 58 L100 55 L102 58 Z" fill="#FFFFFF" opacity="0.9" />
          </>
        )}
        {form === 1 && <path d="M92 58 L100 50 L108 58 L100 64 Z" fill={p.inner} opacity="0.9" />}
      </>
    );
  }
  if (species === "ember") {
    const flames =
      form === 0
        ? [{ x: 100, y: top + 2, s: 0.75 }]
        : form === 1
          ? [{ x: 100, y: top + 2, s: 1 }]
          : [{ x: 86, y: top + 6, s: 0.8 }, { x: 114, y: top + 6, s: 0.8 }, { x: 100, y: top, s: 1.35 }];
    return (
      <>
        {form === 2 && (
          <path d="M64 120 Q100 140 136 120 L133 131 Q100 151 67 131 Z" fill={ref_("flame")} {...line} />
        )}
        {flames.map((f, i) => (
          <g key={i} transform={`translate(${f.x} ${f.y}) scale(${f.s})`}>
            <path d={FLAME} fill={ref_("flame")} {...line} strokeWidth={2 / f.s} />
            <path d={FLAME_CORE} fill="#FFE27A" />
          </g>
        ))}
      </>
    );
  }
  // moss
  if (form === 0) {
    return (
      <g>
        <path d="M100 80 Q99 70 101 62" fill="none" stroke={p.accentDark} strokeWidth="3" strokeLinecap="round" />
        <path d={LEAF} transform="translate(101 64) rotate(-55) scale(0.65)" fill={p.accent} {...line} strokeWidth={2.4} />
        <path d={LEAF} transform="translate(101 64) rotate(55) scale(0.65)" fill={p.accentDark} {...line} strokeWidth={2.4} />
      </g>
    );
  }
  const flowers = form === 2 ? [{ x: 78, y: top + 10 }, { x: 100, y: top + 2 }, { x: 122, y: top + 10 }] : [];
  return (
    <>
      <Pair>
        <circle cx={100 - L.head.r * 0.66} cy={L.head.cy - L.head.r * 0.7} r="8" fill={p.base} {...line} />
        <circle cx={100 - L.head.r * 0.66} cy={L.head.cy - L.head.r * 0.7} r="4" fill={p.inner} />
      </Pair>
      {flowers.map((f, i) => (
        <g key={i} transform={`translate(${f.x} ${f.y})`}>
          {[0, 72, 144, 216, 288].map((a) => (
            <circle key={a} cx={6 * Math.cos((a * Math.PI) / 180)} cy={6 * Math.sin((a * Math.PI) / 180)} r="5" fill="#FFB2C8" stroke="#D9708F" strokeWidth="1.5" />
          ))}
          <circle r="4" fill="#FFD95E" stroke="#D99A2B" strokeWidth="1.5" />
        </g>
      ))}
    </>
  );
}

function Face({ species, form }: { species: Species; form: Form }) {
  const L = LAYOUT[form];
  const y = L.eyeY;
  const dx = L.eyeDx;
  const ink = "#3B2418";
  return (
    <g>
      <Pair>
        <ellipse cx={100 - dx - 11} cy={y + 13} rx="8" ry="5" fill="#FF8E9A" opacity="0.5" />
        <g className="pet-blink">
          <ellipse cx={100 - dx} cy={y} rx="7.5" ry="9" fill={ink} />
          <circle cx={100 - dx - 2.5} cy={y - 3.5} r="3" fill="#FFFFFF" />
          <circle cx={100 - dx + 2.5} cy={y + 3} r="1.4" fill="#FFFFFF" />
        </g>
      </Pair>
      {species === "ember" ? (
        <>
          <path d={`M97 ${y + 8} L103 ${y + 8} L100 ${y + 11} Z`} fill="#F07A8A" />
          <path d={`M100 ${y + 11} L100 ${y + 14} M100 ${y + 14} Q97 ${y + 17} 94 ${y + 15} M100 ${y + 14} Q103 ${y + 17} 106 ${y + 15}`} fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" />
        </>
      ) : (
        <path d={`M93 ${y + 10} Q96.5 ${y + 15} 100 ${y + 11} Q103.5 ${y + 15} 107 ${y + 10}`} fill="none" stroke={ink} strokeWidth="2.2" strokeLinecap="round" />
      )}
    </g>
  );
}
