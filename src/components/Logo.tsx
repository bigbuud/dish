/** Dish-logo: bord met vork en mes, in balpen-stijl. */
export function Logo({ className = "h-9 w-12" }: { className?: string }) {
  return (
    <svg viewBox="70 120 372 280" className={className} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path strokeWidth="22" d="M258 150C320 146 370 198 366 258C362 320 312 366 252 364C192 362 148 314 150 254C152 196 198 152 258 150Z" />
      <path strokeWidth="14" d="M256 190C298 188 330 220 328 258C326 298 294 328 254 326C214 324 188 294 190 256C192 220 218 192 256 190Z" />
      <path strokeWidth="18" d="M92 150V220Q92 258 108 258Q124 258 124 220V150M108 150V258M108 258V392" />
      <path strokeWidth="18" d="M408 150C448 176 446 250 414 274V392M408 150V274" />
    </svg>
  );
}
