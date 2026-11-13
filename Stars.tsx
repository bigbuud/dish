import { Star } from "lucide-react";

export function Stars({ value, onChange, size = 18 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${value} van 5 sterren`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const icon = <Star width={size} height={size} className={n <= value ? "fill-star text-foreground" : "text-foreground/30"} />;
        return onChange ? (
          <button key={n} type="button" aria-label={`${n} sterren`} onClick={() => onChange(n === value ? 0 : n)} className="p-0.5 transition hover:scale-110">
            {icon}
          </button>
        ) : (
          <span key={n}>{icon}</span>
        );
      })}
    </div>
  );
}
