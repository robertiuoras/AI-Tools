"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  hexToHsv,
  hsvToHex,
  rgbToHex,
  rgbToHsl,
  hsvToRgb,
  hslToRgb,
} from "@/lib/color-hsv";

const PRESETS = [
  "e11d48",
  "ea580c",
  "ca8a04",
  "16a34a",
  "2563eb",
  "9333ea",
  "db2777",
  "0d9488",
];

function normalizeHexInput(raw: string): string | null {
  let h = raw.replace(/^#/, "").trim();
  if (/^[0-9a-fA-F]{3}$/.test(h)) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return `#${h.toLowerCase()}`;
}

interface NoteColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  className?: string;
}

/**
 * HSV color picker: 2D saturation/value plane + vertical hue strip (like pro design tools).
 */
export function NoteColorPicker({
  value,
  onChange,
  className,
}: NoteColorPickerProps) {
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  const [s, setS] = useState(1);
  const [v, setV] = useState(1);
  const [hexTyping, setHexTyping] = useState(value);
  const [rgbDraft, setRgbDraft] = useState("0, 0, 0");
  const [hslDraft, setHslDraft] = useState("0, 0%, 0%");
  const draggingSv = useRef(false);
  const draggingHue = useRef(false);
  const hsvRef = useRef({ h: 0, s: 1, v: 1 });
  hsvRef.current = { h, s, v };

  useEffect(() => {
    const norm = normalizeHexInput(value) ?? value;
    const { h: nh, s: ns, v: nv } = hexToHsv(norm);
    setH(nh);
    setS(ns);
    setV(nv);
    setHexTyping(norm);
    const rr = hsvToRgb(nh, ns, nv);
    const hh = rgbToHsl(rr.r, rr.g, rr.b);
    setRgbDraft(
      `${Math.round(rr.r)}, ${Math.round(rr.g)}, ${Math.round(rr.b)}`,
    );
    setHslDraft(
      `${Math.round(hh.h)}, ${Math.round(hh.s)}%, ${Math.round(hh.l)}%`,
    );
  }, [value]);

  const commitHex = useCallback(
    (hex: string) => {
      const n = normalizeHexInput(hex);
      if (!n) return;
      onChange(n);
    },
    [onChange],
  );

  const setFromHsv = useCallback(
    (nh: number, ns: number, nv: number) => {
      setH(nh);
      setS(ns);
      setV(nv);
      const hex = hsvToHex(nh, ns, nv);
      setHexTyping(hex);
      onChange(hex);
    },
    [onChange],
  );

  /** Uses hsvRef so document-level pointermove keeps working outside the SV box. */
  const readSvAt = useCallback(
    (clientX: number, clientY: number) => {
      const el = svRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      const y = Math.max(0, Math.min(1, (clientY - r.top) / r.height));
      const { h: hh } = hsvRef.current;
      setFromHsv(hh, x, 1 - y);
    },
    [setFromHsv],
  );

  const readHueAt = useCallback(
    (clientY: number) => {
      const el = hueRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (clientY - r.top) / r.height));
      const { s: ss, v: vv } = hsvRef.current;
      setFromHsv(360 * (1 - t), ss, vv);
    },
    [setFromHsv],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (draggingSv.current) readSvAt(e.clientX, e.clientY);
      if (draggingHue.current) readHueAt(e.clientY);
    };
    const onEnd = () => {
      draggingSv.current = false;
      draggingHue.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, [readSvAt, readHueAt]);

  const pureHue = hsvToHex(h, 1, 1);

  const onSvPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    draggingSv.current = true;
    readSvAt(e.clientX, e.clientY);
  };

  const onHuePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    draggingHue.current = true;
    readHueAt(e.clientY);
  };

  const commitRgbDraft = useCallback(() => {
    const m = rgbDraft.match(/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/);
    if (!m) return;
    const r = Math.min(255, Math.max(0, Number(m[1])));
    const g = Math.min(255, Math.max(0, Number(m[2])));
    const b = Math.min(255, Math.max(0, Number(m[3])));
    commitHex(rgbToHex(r, g, b));
  }, [rgbDraft, commitHex]);

  const commitHslDraft = useCallback(() => {
    const m = hslDraft.match(
      /^\s*([\d.]+)\s*,\s*([\d.]+)\s*%\s*,\s*([\d.]+)\s*%\s*$/,
    );
    if (!m) return;
    const hh = Number(m[1]) % 360;
    const ss = Math.min(100, Math.max(0, Number(m[2]))) / 100;
    const ll = Math.min(100, Math.max(0, Number(m[3]))) / 100;
    const { r, g, b } = hslToRgb(hh, ss, ll);
    commitHex(rgbToHex(r, g, b));
  }, [hslDraft, commitHex]);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex gap-2">
        <div
          ref={svRef}
          role="presentation"
          className="relative h-36 min-h-[9rem] flex-1 cursor-crosshair touch-none overflow-hidden rounded-md border border-border shadow-inner"
          style={{
            background: `
              linear-gradient(to top, #000, transparent),
              linear-gradient(to right, #fff, ${pureHue})
            `,
          }}
          onPointerDown={onSvPointerDown}
        >
          <div
            className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md ring-1 ring-black/20"
            style={{
              left: `${s * 100}%`,
              top: `${(1 - v) * 100}%`,
            }}
          />
        </div>
        <div
          ref={hueRef}
          role="slider"
          aria-valuenow={Math.round(h)}
          aria-valuemin={0}
          aria-valuemax={360}
          tabIndex={0}
          className="relative h-36 w-7 shrink-0 cursor-pointer touch-none rounded-md border border-border shadow-inner"
          style={{
            background:
              "linear-gradient(to bottom, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
          }}
          onPointerDown={onHuePointerDown}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 10 : 2;
            if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
              e.preventDefault();
              setFromHsv((h + 360 - step) % 360, s, v);
            } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
              e.preventDefault();
              setFromHsv((h + step) % 360, s, v);
            }
          }}
        >
          <div
            className="pointer-events-none absolute right-0 left-0 h-1 -translate-y-1/2 border-y border-white/80 bg-black/10 shadow"
            style={{ top: `${(1 - h / 360) * 100}%` }}
          />
        </div>
        <div
          className="hidden w-10 shrink-0 rounded-md border border-border shadow-inner sm:block"
          style={{ backgroundColor: hsvToHex(h, s, v) }}
          title="Current color"
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">
            Hex
          </Label>
          <Input
            className="h-8 font-mono text-xs"
            spellCheck={false}
            value={hexTyping}
            onChange={(e) => {
              const t = e.target.value;
              setHexTyping(t);
              const n = normalizeHexInput(t);
              if (n) {
                const { h: nh, s: ns, v: nv } = hexToHsv(n);
                setH(nh);
                setS(ns);
                setV(nv);
                onChange(n);
              }
            }}
            placeholder="#RRGGBB"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">
            RGB
          </Label>
          <Input
            className="h-8 font-mono text-xs"
            value={rgbDraft}
            onChange={(e) => setRgbDraft(e.target.value)}
            onBlur={commitRgbDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRgbDraft();
              }
            }}
            placeholder="R, G, B"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">
            HSL
          </Label>
          <Input
            className="h-8 font-mono text-xs"
            value={hslDraft}
            onChange={(e) => setHslDraft(e.target.value)}
            onBlur={commitHslDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitHslDraft();
              }
            }}
            placeholder="H, S%, L%"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            title={`#${c}`}
            className="h-7 w-7 shrink-0 rounded-md border border-border shadow-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ backgroundColor: `#${c}` }}
            onClick={() => commitHex(`#${c}`)}
          />
        ))}
      </div>
    </div>
  );
}
